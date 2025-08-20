import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Vesting } from "../target/types/vesting";

describe("vesting program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = provider.wallet as anchor.Wallet;
  const program = anchor.workspace.Vesting as Program<Vesting>;

  let mint: PublicKey;
  let vestingAccountPda: PublicKey;
  let vestingAccountBump: number;
  let treasuryTokenPda: PublicKey;
  let treasuryBump: number;

  const companyName = "TestCompany";
  const beneficiary = Keypair.generate();
  let employeeAccountPda: PublicKey;
  let employeeBump: number;
  let employeeAta: PublicKey;

  it("Create mint + initialize vesting account", async () => {
    // 1. Create mint
    mint = await createMint(
      provider.connection,
      payer.payer, // fee payer
      payer.publicKey, // mint authority
      null, // freeze authority
      6 // decimals
    );

    // 2. Derive PDA for vesting account
    [vestingAccountPda, vestingAccountBump] =
      PublicKey.findProgramAddressSync(
        [Buffer.from(companyName)],
        program.programId
      );

    [treasuryTokenPda, treasuryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_treasury"), Buffer.from(companyName)],
      program.programId
    );

    // 3. Call instruction
    await program.methods
      .createVestingAccount(companyName)
      .accounts({
        signer: payer.publicKey,
        //@ts-ignore
        vestingAccount: vestingAccountPda,
        mint,
        treasuryTokenAccount: treasuryTokenPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const state = await program.account.vestingAccount.fetch(vestingAccountPda);
    console.log("Vesting account:", state);
  });

  it("Create employee account", async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now;
    const cliff = now + 5; // 5 sec cliff
    const end = now + 20; // vesting ends after 20 sec
    const total = 1000;

    [employeeAccountPda, employeeBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("employee_account"), beneficiary.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .createEmployeeAccount(new anchor.BN(start), new anchor.BN(end), new anchor.BN(cliff), new anchor.BN(total))
      .accounts({
        //@ts-ignore
        owner: payer.publicKey,
        beneficiary: beneficiary.publicKey,
        vestingAccount: vestingAccountPda,
        employeeAccount: employeeAccountPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const employeeState = await program.account.employeeAccount.fetch(
      employeeAccountPda
    );
    console.log("Employee account:", employeeState);
  });

  it("Claim tokens (after cliff)", async () => {
    // mint some tokens to treasury first (simulating funding vesting pool)
    await mintTo(
      provider.connection,
      payer.payer,
      mint,
      treasuryTokenPda,
      payer.publicKey,
      1_000_000 // 1M tokens
    );

    // derive employee ATA
    employeeAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);

    // wait until cliff passes
    await new Promise((resolve) => setTimeout(resolve, 6000));

    await program.methods
  .claimToken(companyName)
  .accounts({
        //@ts-ignore
    beneficiary: beneficiary.publicKey,  
    employeeAccount: employeeAccountPda,
    vestingAccount: vestingAccountPda,
    mint,
    treasuryTokenAccount: treasuryTokenPda,
    employeeTokenAccount: employeeAta,
    systemProgram: SystemProgram.programId,
    associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([beneficiary]) // ✅ must include full Keypair as signer
  .rpc();

    const employeeState = await program.account.employeeAccount.fetch(
      employeeAccountPda
    );
    console.log("Employee state after claim:", employeeState);

    const ataInfo = await getAccount(provider.connection, employeeAta);
    console.log("Beneficiary ATA balance:", ataInfo.amount.toString());
  });
});
