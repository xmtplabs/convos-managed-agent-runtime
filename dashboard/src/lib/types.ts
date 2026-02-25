export interface AgentSkill {
  slug: string;
  name: string;
  description: string;
  category: string;
  emoji: string;
  skills: string[];
  status: string;
  notionPageId: string | null;
}

export interface PoolCounts {
  idle: number;
  starting: number;
  claimed: number;
  crashed: number;
}

export interface PromptData {
  prompt: string;
}

export interface ClaimResponse {
  joined?: boolean;
  inviteUrl?: string;
  agentName?: string;
  instanceId?: string;
  error?: string;
}
