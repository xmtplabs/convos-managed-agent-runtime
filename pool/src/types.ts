export type { InstanceStatus, InstanceRow, InfraRow, ServiceRow } from "./db/schema";

export interface CreateInstanceRequest {
  instanceId: string;
  name: string;
  tools?: string[];
}

export interface CreateInstanceResponse {
  instanceId: string;
  serviceId: string;
  url: string | null;
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
