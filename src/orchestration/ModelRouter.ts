import { resolveDefaultProviderModel } from '../agents/providerConfig';
import { logger } from '../lib/logger';

export interface RouterDecision {
    tier: 'pro' | 'flash';
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
}

export class ModelRouter {
    private isEnabled = true;
    private hasLoggedFallback = false;

    constructor() {
        const routerEnabled = process.env.ROUTER_ENABLED !== '0' && process.env.ROUTER_ENABLED !== 'false';
        if (!routerEnabled) {
            this.isEnabled = false;
        }
    }

    private parseRouterDecision(text: string): 'pro' | 'flash' {
        const trimmed = text.trim();
        const jsonText = trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
        try {
            const parsed = JSON.parse(jsonText);
            return parsed?.tier === 'pro' ? 'pro' : 'flash';
        } catch {
            return 'flash';
        }
    }

    /**
     * Analyzes a user prompt using the system's default lightweight model to determine
     * the optimal execution tier (e.g., 'pro' vs 'flash').
     */
    public async determineRequiredModel(userPrompt: string): Promise<RouterDecision> {
        if (!this.isEnabled) {
            if (!this.hasLoggedFallback) {
                this.hasLoggedFallback = true;
                logger.warn('[Router] Disabled by ROUTER_ENABLED, defaulting prompts to flash tier');
            }
            return { tier: 'flash' };
        }

        const routingInstruction = [
            'You are a routing system for intelligent agent model selection.',
            'Return JSON only — no explanation, no markdown.',
            '',
            'TIER DEFINITIONS:',
            '- pro: The heavy lifter. Use for Google Workspace plugin tasks,',
            '  complex MCP tool orchestration, multi-step reasoning, deep debugging, architecture decisions,',
            '  or any prompt that requires reading multiple files and synthesizing a plan.',
            '- flash: The default. Use for general coding questions, chat,',
            '  single-file modifications, quick lookups, summarization, and simple text generation.',
            '',
            'Choose {"tier":"pro"} only when the prompt clearly demands the heavy lifter capabilities above.',
            'Choose {"tier":"flash"} for everything else.',
            `Prompt: ${JSON.stringify(userPrompt)}`
        ].join('\n');

        try {
            // Lazy load spawnAgent to prevent circular dependencies
            const { spawnAgent } = await import('../agents/spawner');
            const defaultModel = resolveDefaultProviderModel();

            const response = await spawnAgent(routingInstruction, {
                provider: defaultModel.provider,
                model: defaultModel.model,
                temperature: 0
            });
            
            const text = response.output || '';
            const tier = this.parseRouterDecision(text);
            
            logger.info({ tier }, 'router selected model tier');

            return {
                tier,
                usage: {
                    inputTokens: response.inputTokens,
                    outputTokens: response.outputTokens
                }
            };

        } catch (err) {
            logger.error({ err }, 'routing failed, defaulting to flash model');
            return { tier: 'flash' };
        }
    }
}
