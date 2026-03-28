export interface AgentSkill {
  id: string;
  slug: string;
  agentName: string;
  description: string;
  prompt: string;
  category: string;
  emoji: string;
  tools: string[];
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PoolCounts {
  idle: number;
  starting: number;
  claimed: number;
  crashed: number;
}

export interface ClaimResponse {
  joined?: boolean;
  inviteUrl?: string;
  agentName?: string;
  instanceId?: string;
  error?: string;
}
