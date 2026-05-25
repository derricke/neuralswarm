export interface TokenUsage {
    inputTokens: number;
    cacheReads: number;
    outputTokens: number;
}

export interface AgentMetrics {
    requests: number;
    inputTokens: number;
    cacheReads: number;
    outputTokens: number;
}

export interface ModelMetrics {
    model: string;
    requests: number;
    inputTokens: number;
    cacheReads: number;
    outputTokens: number;
    agents: Record<string, AgentMetrics>;
}

export class UsageTracker {
    // Maps modelId to its accumulated usage statistics
    private usageStats: Map<string, ModelMetrics> = new Map();

    /**
     * Records token usage for a given model and agent invocation.
     */
    public recordUsage(
        modelId: string, 
        agentName: string, 
        inputTokens: number, 
        cacheReads: number, 
        outputTokens: number
    ): void {
        if (!this.usageStats.has(modelId)) {
            this.usageStats.set(modelId, {
                model: modelId,
                requests: 0,
                inputTokens: 0,
                cacheReads: 0,
                outputTokens: 0,
                agents: {}
            });
        }

        const stat = this.usageStats.get(modelId)!;
        stat.requests += 1;
        stat.inputTokens += inputTokens;
        stat.cacheReads += cacheReads;
        stat.outputTokens += outputTokens;

        if (!stat.agents[agentName]) {
            stat.agents[agentName] = { requests: 0, inputTokens: 0, cacheReads: 0, outputTokens: 0 };
        }

        const agentStat = stat.agents[agentName];
        agentStat.requests += 1;
        agentStat.inputTokens += inputTokens;
        agentStat.cacheReads += cacheReads;
        agentStat.outputTokens += outputTokens;
    }

    /**
     * Retrieves a serialized snapshot of the current usage stats,
     * suitable for logging or emitting over a network/WebSocket.
     */
    public getSerializedStats(): Record<string, ModelMetrics> {
        const payload: Record<string, ModelMetrics> = {};
        for (const [modelId, stat] of this.usageStats) {
            payload[modelId] = {
                model: stat.model,
                requests: stat.requests,
                inputTokens: stat.inputTokens,
                cacheReads: stat.cacheReads,
                outputTokens: stat.outputTokens,
                agents: { ...stat.agents } // shallow clone the agent metrics to prevent immediate mutation bugs
            };
        }
        return payload;
    }
}

export const globalUsageTracker = new UsageTracker();

