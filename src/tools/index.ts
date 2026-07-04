/**
 * Ferramentas MCP (Tools) - Interface entre o MCP Server e os Agentes
 * 
 * Cada ferramenta expõe uma funcionalidade que pode ser chamada
 * pelo cliente MCP (ex: Kiro, Claude Desktop, Cursor)
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AzureDevOpsService } from '../services/azure-devops.service.js';
import { WorkflowPipelineManager } from '../workflow/pipeline.js';
import { AppConfig } from '../config/index.js';
import {
  AnalysisAgent,
  BuildAgent,
  TestAgent,
  RunnerAgent,
} from '../agents/index.js';

export function registerTools(
  server: McpServer,
  azureService: AzureDevOpsService,
  pipelineManager: WorkflowPipelineManager,
  appConfig: AppConfig
): void {
  // ============================================================
  // Tool 1: Buscar Feature
  // ============================================================
  server.tool(
    'buscar_feature',
    'Busca uma Feature no Azure DevOps pelo ID e retorna todas as informações, incluindo tasks, test cases e critérios de aceite',
    {
      featureId: z.number().describe('ID da Feature no Azure DevOps'),
    },
    async ({ featureId }) => {
      try {
        const feature = await azureService.getFeature(featureId);
        const tasks = await azureService.getFeatureTasks(featureId);
        const testCases = await azureService.getFeatureTestCases(featureId);
        const testTasks = await azureService.getFeatureTestTasks(featureId);

        const result = {
          feature: {
            id: feature.id,
            title: feature.title,
            state: feature.state,
            description: feature.description,
            acceptanceCriteria: feature.acceptanceCriteria,
            assignedTo: feature.assignedTo,
            tags: feature.tags,
          },
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            state: t.state,
            assignedTo: t.assignedTo,
          })),
          testCases: testCases.map((tc) => ({
            id: tc.id,
            title: tc.title,
            state: tc.state,
          })),
          testTasks: testTasks.map((tt) => ({
            id: tt.id,
            title: tt.title,
            state: tt.state,
          })),
          summary: `Feature #${feature.id} "${feature.title}" - ${tasks.length} tasks, ${testCases.length} test cases, ${testTasks.length} tasks de teste`,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Erro ao buscar feature: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 2: Analisar Feature
  // ============================================================
  server.tool(
    'analisar_feature',
    'Executa análise refinada de uma Feature: mapeia codebase, identifica impactos, gera plano de implementação e solicita aprovação',
    {
      featureId: z.number().describe('ID da Feature para análise'),
    },
    async ({ featureId }) => {
      try {
        const agent = new AnalysisAgent(azureService, appConfig);
        const result = await agent.execute({ featureId });

        if (!result.success) {
          return {
            content: [{ type: 'text' as const, text: `Análise falhou: ${result.message}\n\nLogs:\n${result.logs.join('\n')}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Erro na análise: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 3: Executar Pipeline Completo
  // ============================================================
  server.tool(
    'executar_pipeline',
    'Inicia o pipeline completo de automação para uma Feature: análise → aprovação → tasks → build → testes → validação → PR',
    {
      featureId: z.number().describe('ID da Feature para executar o pipeline completo'),
    },
    async ({ featureId }) => {
      try {
        const pipeline = await pipelineManager.startPipeline(featureId);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              pipelineId: pipeline.id,
              featureId: pipeline.featureId,
              status: pipeline.status,
              steps: pipeline.steps.map((s) => ({
                name: s.name,
                agent: s.agent,
                status: s.status,
              })),
              message: `Pipeline iniciado para Feature #${featureId}. Use 'status_pipeline' para acompanhar.`,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Erro ao iniciar pipeline: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 4: Status do Pipeline
  // ============================================================
  server.tool(
    'status_pipeline',
    'Verifica o status atual de um pipeline em execução',
    {
      pipelineId: z.string().describe('ID do pipeline para verificar'),
    },
    async ({ pipelineId }) => {
      const pipeline = pipelineManager.getPipeline(pipelineId);

      if (!pipeline) {
        return {
          content: [{ type: 'text' as const, text: `Pipeline ${pipelineId} não encontrado` }],
          isError: true,
        };
      }

      const result = {
        id: pipeline.id,
        featureId: pipeline.featureId,
        status: pipeline.status,
        startedAt: pipeline.startedAt,
        completedAt: pipeline.completedAt,
        steps: pipeline.steps.map((s) => ({
          name: s.name,
          agent: s.agent,
          status: s.status,
          duration: s.result?.duration,
          message: s.result?.message,
        })),
        pendingApprovals: pipeline.approvals.filter((a) => a.status === 'pending'),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================================
  // Tool 5: Aprovar Etapa
  // ============================================================
  server.tool(
    'aprovar_etapa',
    'Aprova ou rejeita uma etapa do pipeline que aguarda aprovação',
    {
      approvalId: z.string().describe('ID da aprovação pendente'),
      approved: z.boolean().describe('true para aprovar, false para rejeitar'),
    },
    async ({ approvalId, approved }) => {
      const success = pipelineManager.approveStep(approvalId, approved);

      if (!success) {
        return {
          content: [{ type: 'text' as const, text: `Aprovação ${approvalId} não encontrada ou já processada` }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Etapa ${approved ? 'APROVADA ✅' : 'REJEITADA ❌'}. Pipeline continuará ${approved ? 'execução' : 'com cancelamento'}.`,
        }],
      };
    }
  );

  // ============================================================
  // Tool 6: Executar Build
  // ============================================================
  server.tool(
    'executar_build',
    'Executa o build de todos os projetos no workspace',
    {
      configuration: z.string().optional().describe('Configuração de build (Debug/Release)'),
    },
    async ({ configuration }) => {
      try {
        const agent = new BuildAgent(appConfig);
        // Descobrir projetos usando o AnalysisAgent helper
        const analysisAgent = new AnalysisAgent(azureService, appConfig);
        
        const result = await agent.execute({
          projects: [],
          workspaceRoot: appConfig.workspace.root,
          configuration: configuration || appConfig.build.configuration,
        });

        return {
          content: [{
            type: 'text' as const,
            text: `${result.success ? '✅' : '❌'} ${result.message}\n\nLogs:\n${result.logs.slice(-20).join('\n')}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Erro no build: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 7: Executar Testes
  // ============================================================
  server.tool(
    'executar_testes',
    'Executa testes do projeto (unitários, integração, e2e ou todos)',
    {
      testType: z.enum(['unit', 'integration', 'e2e', 'all']).describe('Tipo de teste para executar'),
    },
    async ({ testType }) => {
      try {
        const agent = new TestAgent(appConfig);
        const result = await agent.execute({
          testType,
          projects: [],
          workspaceRoot: appConfig.workspace.root,
        });

        return {
          content: [{
            type: 'text' as const,
            text: `${result.success ? '✅' : '❌'} ${result.message}\n\nLogs:\n${result.logs.slice(-20).join('\n')}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Erro nos testes: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 8: Executar Localmente
  // ============================================================
  server.tool(
    'executar_local',
    'Inicia os projetos localmente e valida com health checks',
    {
      healthCheckUrl: z.string().optional().describe('URL para health check (padrão: http://localhost:5000)'),
    },
    async ({ healthCheckUrl }) => {
      try {
        const agent = new RunnerAgent(appConfig);
        const result = await agent.execute({
          projects: [],
          workspaceRoot: appConfig.workspace.root,
          healthCheckUrl,
        });

        return {
          content: [{
            type: 'text' as const,
            text: `${result.success ? '✅' : '❌'} ${result.message}\n\nLogs:\n${result.logs.slice(-15).join('\n')}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Erro na execução local: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 9: Listar Aprovações Pendentes
  // ============================================================
  server.tool(
    'listar_aprovacoes',
    'Lista todas as aprovações pendentes nos pipelines em execução',
    {},
    async () => {
      const approvals = pipelineManager.getPendingApprovals();

      if (approvals.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Nenhuma aprovação pendente.' }],
        };
      }

      const result = approvals.map((a) => ({
        id: a.id,
        message: a.message,
        requestedAt: a.requestedAt,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
