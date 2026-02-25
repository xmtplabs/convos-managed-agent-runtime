export interface InfraRow {
  instance_id: string;
  provider: string;
  provider_service_id: string;
  provider_env_id: string;
  url: string | null;
  deploy_status: string | null;
  runtime_image: string | null;
  volume_id: string | null;
  gateway_token: string | null;
  setup_password: string | null;
  wallet_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceRow {
  id: number;
  instance_id: string;
  tool_id: string;
  resource_id: string;
  resource_meta: Record<string, unknown>;
  env_key: string;
  env_value: string | null;
  status: string;
  created_at: string;
}

export interface CreateInstanceRequest {
  instanceId: string;
  name: string;
  tools?: string[];
}

export interface CreateInstanceResponse {
  instanceId: string;
  serviceId: string;
  url: string | null;
  gatewayToken: string;
  services: {
    openrouter?: { resourceId: string };
    agentmail?: { resourceId: string };
    telnyx?: { resourceId: string };
  };
}

export interface DestroyResult {
  instanceId: string;
  destroyed: {
    openrouter: boolean;
    agentmail: boolean;
    telnyx: boolean;
    volumes: boolean;
    service: boolean;
  };
}

export interface BatchStatusResponse {
  services: Array<{
    instanceId: string;
    serviceId: string;
    name: string;
    deployStatus: string | null;
    domain: string | null;
    image: string | null;
    environmentIds: string[];
  }>;
}

export interface ToolRegistryEntry {
  id: string;
  name: string;
  mode: string;
  envKeys: string[];
}

export interface ProvisionResult {
  toolId: string;
  resourceId: string;
  envKey: string;
  status: string;
}
