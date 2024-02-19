import {
    blob,
    Canister,
    ic,
    Err,
    nat64,
    Ok,
    Opt,
    Principal,
    query,
    Record,
    Result,
    StableBTreeMap,
    text,
    update,
    Variant,
    Vec,
    bool
} from 'azle';
import { log } from 'console';

const BankAccount = Record({
    id: Principal,
    owner: Principal,
    bank: text,
    accountNumber: text
})

const UserBill = Record({
    id: Principal,
    user: Principal,
    bill: Principal,
    amount: nat64,
    paid: bool
})

const Bill = Record({
    id: Principal,
    owner: Principal,
    createdAt: nat64,
    userBills: Vec(Principal)
})


const User = Record({
    id: Principal,
    username: text,
    email: text,
    bankAccounts: Vec(Principal),
    bills: Vec(Principal)
})


const SplitBillError = Variant({
    BillNotFound: Principal,
    UserNotFound: Principal,
    BankAccountNotFound: Principal,
    UserNotInBill: Principal
})

type UserBill = typeof UserBill.tsType


type BankAccount = typeof BankAccount.tsType
type Bill = typeof Bill.tsType
type User = typeof User.tsType
type SplitBillError = typeof SplitBillError.tsType

let bankAccounts = StableBTreeMap<Principal, BankAccount>(0);
let userBills = StableBTreeMap<Principal, UserBill>(1);
let bills = StableBTreeMap<Principal, Bill>(2);
let users = StableBTreeMap<Principal, User>(3);


export default Canister({
    createUser: update([text, text], User, (username, email) => {
        const id = generateId();
        const user: User = {
            id: id,
            username: username,
            email: email,
            bankAccounts: [],
            bills: []
        };
        users.insert(id, user);
        return user;
    }),
    getUserById: query([Principal], Opt(User), (id) => {
        return users.get(id);
    }),
    registerBankAccount: update([Principal, text, text], BankAccount, (owner, bank, accountNumber) => {
        const id = generateId();
        const bankAccount: BankAccount = {
            id: id,
            owner: owner,
            bank: bank,
            accountNumber: accountNumber
        };
        bankAccounts.insert(id, bankAccount);
        return bankAccount;
    }),
    getBankAccountById: query([Principal], Opt(BankAccount), (id) => {
        return bankAccounts.get(id);
    }),
    getBillById: query([Principal], Opt(Bill), (id) => {
        return bills.get(id);
    }),
    getSplitBillParticipant: query([Principal], Result(Vec(UserBill), SplitBillError), (id) => {
        let billOpt = bills.get(id);
        if ('None' in billOpt) {
            return Err({
                BillNotFound: id
            });
        }
        const bill = billOpt.Some

        let participant: UserBill[] = [];
        for (let i = 0; i < bill.userBills.length; i++) {
            let userBillOpt = userBills.get(bill.userBills[i]);
            if ('None' in userBillOpt) {
                return Err({
                    BillNotFound: id
                });
            }
            participant.push(userBillOpt.Some);
        }
        return Ok(participant)
    }),
    splitBill: update([Principal, Vec(Principal), nat64], Result(Bill, SplitBillError), (owner, splitParticipant, amount) => {
        let billId = generateId();
        let personAmount = amount / BigInt(splitParticipant.length);

        let userBillIds: Principal[] = [];
        for (let i = 0; i < splitParticipant.length; i++) {
            let userBillId = generateId();
            let userBill: UserBill = {
                id: userBillId,
                user: splitParticipant[i],
                bill: billId,
                amount: personAmount,
                paid: false
            };
            userBills.insert(userBillId, userBill);
            userBillIds.push(userBillId);
        }

        let bill: Bill = {
            id: billId,
            owner: owner,
            createdAt: ic.time(),
            userBills: userBillIds
        };
        bills.insert(billId, bill);
        return Ok(bill);
    }),
    payBill: update([Principal, Principal], Result(UserBill, SplitBillError), (id, userId) => {
        let userBillOpt = userBills.get(id);
        if ('None' in userBillOpt) {
            return Err({
                BillNotFound: id
            });
        }
        let userBill = userBillOpt.Some;
        console.log(userBill.user, userId);
        console.log(userBill.user.compareTo(userId) != 'eq');
        if (userBill.user.compareTo(userId) != 'eq') {
            return Err({
                UserNotInBill: userBill.user
            });
        }
        userBill.paid = true;
        userBills.insert(id, userBill);
        return Ok(userBill);
    }),
    getMyDueBill: query([Principal], Vec(Bill), (userId) => {
        let dueBills: Bill[] = [];
        // Get User
        let userOpt = users.get(userId);
        if ('None' in userOpt) {
            // User Not Found
            return [];
        }
        let user = userOpt.Some;

        // Get User Bills for that user
        let userBillIds = user.bills;
        let specificUserBills: UserBill[] = [];
        for (let i = 0; i < userBillIds.length; i++) {
            let userBillOpt = userBills.get(userBillIds[i]);
            if ('None' in userBillOpt) {
                continue;
            }
            specificUserBills.push(userBillOpt.Some);
        }

        // Get Bills that are due
        for (let i = 0; i < specificUserBills.length; i++) {
            if (specificUserBills[i].user.compareTo(userId) != 'eq' && !specificUserBills[i].paid) {
                let billOpt = bills.get(specificUserBills[i].bill);
                if ('None' in billOpt) {
                    continue;
                }
                dueBills.push(billOpt.Some);
            }
        }
        return dueBills;
    }),
    getPaymentMethodsFromUserBill: query([Principal], Vec(BankAccount), (userBillId) => {
        // Get User Bill
        let userBillOpt = userBills.get(userBillId);
        if ('None' in userBillOpt) {
            return [];
        }
        let userBill = userBillOpt.Some;

        // Get Bill
        let billId = userBill.bill;
        let billOpt = bills.get(billId);
        if ('None' in billOpt) {
            return [];
        }
        let bill = billOpt.Some;

        // Get Bill Owner
        let billOwnerId = bill.owner;
        let userOpt = users.get(billOwnerId);
        if ('None' in userOpt) {
            return [];
        }
        let user = userOpt.Some;
        let bankAccountIds = user.bankAccounts;

        // Get Their Bank Accounts
        let ownerBankAccounts: BankAccount[] = [];
        for (let i = 0; i < bankAccountIds.length; i++) {
            let bankAccountOpt = bankAccounts.get(bankAccountIds[i]);
            if ('None' in bankAccountOpt) {
                continue;
            }
            ownerBankAccounts.push(bankAccountOpt.Some);
        }
        return ownerBankAccounts;
    }),
    removeBankAccount: update([Principal], Result(BankAccount, SplitBillError), (id) => {
        let bankAccountOpt = bankAccounts.get(id);
        if ('None' in bankAccountOpt) {
            return Err({
                BankAccountNotFound: id
            });
        }
        let bankAccount = bankAccountOpt.Some;
        bankAccounts.remove(id);
        return Ok(bankAccount);
    })
})

function generateId(): Principal {
    const randomBytes = new Array(29)
        .fill(0)
        .map((_) => Math.floor(Math.random() * 256));

    return Principal.fromUint8Array(Uint8Array.from(randomBytes));
}