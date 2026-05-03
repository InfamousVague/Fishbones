//! A minimal counter program. One instruction (`increment`); no
//! variants, no instruction data needed.
//!
//! ### Accounts
//!
//! 0. `[writable]` counter — owned by this program; data is a single
//!    little-endian u64 holding the current count.
//!
//! ### Errors
//!
//! - Returns `InvalidAccountData` if the counter account is not 8
//!   bytes (caller forgot to allocate it via System Program).
//! - Returns `IncorrectProgramId` if the counter isn't owned by this
//!   program (mis-deploy / wrong account passed).

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    let accs = &mut accounts.iter();
    let counter = next_account_info(accs)?;

    // The counter account must be writable, sized exactly for a u64,
    // and owned by us (otherwise someone else could spoof a counter).
    if counter.owner != program_id {
        msg!("counter is not owned by this program");
        return Err(ProgramError::IncorrectProgramId);
    }
    if counter.data_len() != 8 {
        msg!("counter must be 8 bytes (u64), got {}", counter.data_len());
        return Err(ProgramError::InvalidAccountData);
    }

    // Decode the current count, increment, write back. Mutable borrow
    // is scoped so the borrow_mut goes out of scope before we return.
    let mut data = counter.try_borrow_mut_data()?;
    let current = u64::from_le_bytes(data[..8].try_into().unwrap());
    let next = current.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;
    data[..8].copy_from_slice(&next.to_le_bytes());

    msg!("counter: {} -> {}", current, next);
    Ok(())
}
