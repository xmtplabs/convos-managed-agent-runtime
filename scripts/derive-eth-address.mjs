import { Wallet } from "ethers";

const pk = process.argv[2] ?? process.env.BANKR_WALLET_PRIVATE_KEY ?? "";
const key = pk.startsWith("0x") ? pk : `0x${pk}`;
const wallet = new Wallet(key);
console.log(wallet.address);
