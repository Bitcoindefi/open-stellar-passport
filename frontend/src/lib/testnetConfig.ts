import { resolveTestnetConfig } from "../../../config/testnet.mjs";

export const TESTNET_CONFIG = resolveTestnetConfig(import.meta.env);
