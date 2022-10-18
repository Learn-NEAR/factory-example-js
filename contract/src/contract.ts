import {
  NearBindgen,
  near,
  call,
  view,
  includeBytes,
  assert,
  NearPromise,
  validateAccountId,
} from "near-sdk-js";
import { AccountId, Balance, PublicKey } from "near-sdk-js/lib/types";
import { serialize } from "near-sdk-js/lib/utils";

const NEAR_PER_STORAGE = 10n ** 19n; // 10e19yⓃ
const DEFAULT_CONTRACT = includeBytes("./donation-contract/donation.wasm");
const TGAS = 10n ** 12n; // 10e12yⓃ
const NO_DEPOSIT = 0n; // 0yⓃ

interface DonationInitArgs {
  beneficiary: string;
}

@NearBindgen({})
export class HelloNear {
  code: string = DEFAULT_CONTRACT;

  @call({ privateFunction: true })
  update_stored_contract(): void {
    // This method receives the code to be stored in the contract directly
    // from the contract's input. In this way, it avoids the overhead of
    // deserializing parameters, which would consume a huge amount of GAS
    const input = near.input();

    assert(input, "Error: No input");

    this.code = input;
  }

  @view({})
  get_code(): string {
    // If a contract wants to update themselves, they can ask us for the code needed
    return this.code;
  }

  @call({ payableFunction: true })
  create_factory_subaccount_and_deploy({
    name,
    beneficiary,
    public_key,
  }: {
    name: string;
    beneficiary: AccountId;
    public_key?: string;
  }): NearPromise {
    // Assert the sub-account is valid
    const currentAccount = near.currentAccountId();
    const subaccount = `${name}.${currentAccount}`;

    assert(validateAccountId(subaccount), "Invalid subaccount");

    // Assert enough money is attached to create the account and deploy the contract
    const attached = near.attachedDeposit();

    const contractBytes = this.code.length;
    const minimumNeeded = NEAR_PER_STORAGE * BigInt(contractBytes);

    assert(attached >= minimumNeeded, `Attach at least ${minimumNeeded} yⓃ`);

    const initArgs: DonationInitArgs = { beneficiary };

    const promise = NearPromise.new(subaccount)
      .createAccount()
      .transfer(attached)
      .deployContract(this.code)
      .functionCall("init", serialize(initArgs), NO_DEPOSIT, TGAS * 5n);

    // Add full access key is the user passes one
    if (public_key) {
      promise.addFullAccessKey(new PublicKey(public_key));
    }

    // Add callback
    const callbackArgs: Parameters<
      typeof this.create_factory_subaccount_and_deploy_callback
    >[0] = {
      account: subaccount,
      user: near.predecessorAccountId(),
      attached,
    };

    return promise.then(
      NearPromise.new(currentAccount).functionCall(
        "create_factory_subaccount_and_deploy_callback",
        serialize(callbackArgs),
        NO_DEPOSIT,
        TGAS * 5n
      )
    );
  }

  @call({ privateFunction: true })
  create_factory_subaccount_and_deploy_callback({
    account,
    user,
    attached,
  }: {
    account: AccountId;
    user: AccountId;
    attached: Balance;
  }): boolean {
    try {
      near.promiseResult(0);
      near.log(`Correctly created and deployed to ${account}`);

      return true;
    } catch {
      near.log(`Error creating ${account}, returning ${attached}yⓃ to ${user}`);

      return false;
    }
  }
}
