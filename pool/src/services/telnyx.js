function getEnv(name) {
  const val = process.env[name];
  return val != null && val !== "" ? val : "";
}

export async function resolve() {
  return {
    envVars: {
      TELNYX_API_KEY: getEnv("TELNYX_API_KEY"),
      TELNYX_PHONE_NUMBER: getEnv("TELNYX_PHONE_NUMBER"),
      TELNYX_MESSAGING_PROFILE_ID: getEnv("TELNYX_MESSAGING_PROFILE_ID"),
    },
    cleanupHandle: null,
  };
}

export async function cleanup() {}
