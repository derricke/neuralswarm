import { resolveDefaultProviderModel } from '../agents/providerConfig';
import { logger } from '../lib/logger';

export interface Message {
    role: string;
    content: string;
}

export class ContextManager {
    private compressionThreshold: number;

    constructor(threshold = 300000) {
        this.compressionThreshold = Number(process.env.CONTEXT_COMPRESSION_TOKEN_THRESHOLD || threshold);
    }

    /**
     * Normalizes token counts from various SDK response payload formats.
     */
    public extractTokenCount(metadata: any): number {
        if (!metadata) return 0;
        
        const usage = metadata.usageMetadata || metadata.usage;
        if (usage) {
            return (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0);
        }

        return metadata.totalTokenCount || 0;
    }

    /**
     * Extracts input/output tokens accurately from SDK metadata.
     */
    public extractMessageTokenBreakdown(metadata: any): { inputTokens: number; outputTokens: number } {
        if (!metadata) return { inputTokens: 0, outputTokens: 0 };
        
        const usage = metadata.usageMetadata || metadata.usage;
        if (usage) {
            return {
                inputTokens: usage.promptTokenCount || usage.inputTokenCount || 0,
                outputTokens: usage.candidatesTokenCount || usage.outputTokenCount || 0
            };
        }
        
        return { inputTokens: 0, outputTokens: 0 };
    }

    /**
     * Monitors context size and performs a summary check. If context exceeds the
     * threshold, it asks the model to summarize older messages and returns a new 
     * compressed history list to save context window space.
     */
    public async checkAndCompressContext(
        history: Message[], 
        currentTokenCount: number
    ): Promise<Message[] | null> {
        if (currentTokenCount < this.compressionThreshold) {
            return null; // No compression needed
        }

        logger.info({ currentTokenCount, threshold: this.compressionThreshold }, 'compressing session history');

        try {
            const historyText = history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
            const prompt = `Please summarize the following conversation history into a concise but comprehensive context checkpoint. Retain key facts, decisions, user preferences, and any unresolved context. \n\nHistory:\n${historyText}`;
            
            // Lazy load spawnAgent to prevent circular dependencies with providers
            const { spawnAgent } = await import('../agents/spawner');
            const defaultModel = resolveDefaultProviderModel();

            const response = await spawnAgent(prompt, {
                provider: defaultModel.provider,
                model: defaultModel.model,
                systemPrompt: 'You are a highly capable AI assistant specializing in information compression and context summarization.'
            });

            const summary = response.output || 'Context compression failed to produce output.';

            logger.info('context compressed successfully');
            
            return [
                {
                    role: 'system',
                    content: `[PREVIOUS CONVERSATION SUMMARY]:\n${summary}`
                }
            ];
            
        } catch (err) {
            logger.error({ err }, 'failed to create checkpoint session summary');
            return history.slice(Math.floor(history.length / 2));
        }
    }
}
