export const TESTNET_DEFAULTS = Object.freeze({
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  viewerPublicKey: "GC7SABHJPHM7ETSM6RJJOJL3NXJK2EJCY324HLXPMB53NZHISWIMSGBP",
  validatorContractId:
    "CDNSZUNEWFCGSPWLPDSWTENR2WPHKC34RGZQG7RJA54OPGTZGVVRFYBA",
  verifierContractId:
    "CCMKLYSRUH2HMA4UU6WLXWQXEY6KAH5AWB5BEVMJGNGC5GLGTVROLG4A",
});

const pick = (...values) =>
  values.find((value) => typeof value === "string" && value.length > 0);

export function resolveTestnetConfig(env = {}) {
  return {
    networkPassphrase:
      pick(
        env.STELLAR_NETWORK_PASSPHRASE,
        env.VITE_STELLAR_NETWORK_PASSPHRASE,
      ) ?? TESTNET_DEFAULTS.networkPassphrase,
    rpcUrl:
      pick(env.STELLAR_RPC_URL, env.VITE_STELLAR_RPC_URL) ??
      TESTNET_DEFAULTS.rpcUrl,
    viewerPublicKey:
      pick(env.VIEWER_PUBLIC_KEY, env.VITE_VIEWER_PUBLIC_KEY) ??
      TESTNET_DEFAULTS.viewerPublicKey,
    validatorContractId:
      pick(env.VALIDATOR_CONTRACT_ID, env.VITE_VALIDATOR_CONTRACT_ID) ??
      TESTNET_DEFAULTS.validatorContractId,
    verifierContractId:
      pick(env.VERIFIER_CONTRACT_ID, env.VITE_VERIFIER_CONTRACT_ID) ??
      TESTNET_DEFAULTS.verifierContractId,
  };
}

export const testnetConfig = resolveTestnetConfig(
  typeof process === "undefined" ? {} : process.env,
);
