/**
 * Pipeline de Workflow - Orquestrador dos Agentes
 * 
 * Gerencia o fluxo completo:
 * 1. Git Setup (fetch + pull master + criar branch feature/{id}) →
 * 2. Analisar → 3. Aprovar → 4. Executar Tasks →
 * 5. Build → 6. Testes → 7. Execução Local → 8. Criar PR →
 * 9. Documentação (docs-dracma)
 */
import {
  WorkflowPipeline,
  WorkflowStep,
  ApprovalRequest,
  FeatureAnalysis,
  AgentResult,
} from '../types/index.js';
import { AzureDevOpsService } from '../services/azure-devops.service.js';
import { AppConfig } from '../config/index.js';
import {
  AnalysisAgent,
  TaskExecutorAgent,
  BuildAgent,
  TestAgent,
  RunnerAgent,
  PullRequestAgent,
  DocumentationAgent,
  GitSetupAgent,
} from '../agents/index.js';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

export class WorkflowPipelineManager extends EventEmitter {
  private azureService: AzureDevOpsService;
  private appConfig: AppConfig;
  private pipelines: Map<string, WorkflowPipeline> = new Map();
  private pendingApprovals: Map<string, (approved: boolean) => void> = new Map();

  constructor(azureService: AzureDevOpsService, appConfig: AppConfig) {
    super();
    this.azureService = azureService;
    this.appConfig = appConfig;
  }

  /**
   * Inicia o pipeline completo para uma Feature
   */
  async startPipeline(featureId: number): Promise<WorkflowPipeline> {
    const pipelineId = randomUUID();

    const pipeline: WorkflowPipeline = {
      id: pipelineId,
      featureId,
      steps: this.createSteps(),
      status: 'running',
      startedAt: new Date(),
      approvals: [],
    };

    this.pipelines.set(pipelineId, pipeline);
    this.emit('pipeline:started', pipeline);

    // Executar pipeline assincronamente
    this.executePipeline(pipeline).catch((error) => {
      pipeline.status = 'failed';
      this.emit('pipeline:failed', pipeline, error);
    });

    return pipeline;
  }

  /**
   * Aprova ou rejeita uma solicitação pendente
   */
  approveStep(approvalId: string, approved: boolean): boolean {
    const resolver = this.pendingApprovals.get(approvalId);
    if (!resolver) return false;

    resolver(approved);
    this.pendingApprovals.delete(approvalId);

    // Atualizar status na pipeline
    for (const pipeline of this.pipelines.values()) {
      const approval = pipeline.approvals.find((a) => a.id === approvalId);
      if (approval) {
        approval.status = approved ? 'approved' : 'rejected';
        approval.respondedAt = new Date();
        break;
      }
    }

    return true;
  }

  /**
   * Retorna o estado atual de um pipeline
   */
  getPipeline(pipelineId: string): WorkflowPipeline | undefined {
    return this.pipelines.get(pipelineId);
  }

  /**
   * Lista todas as aprovações pendentes
   */
  getPendingApprovals(): ApprovalRequest[] {
    const pending: ApprovalRequest[] = [];
    for (const pipeline of this.pipelines.values()) {
      pending.push(...pipeline.approvals.filter((a) => a.status === 'pending'));
    }
    return pending;
  }

  // ============================================================
  // Execução do Pipeline
  // ============================================================

  private async executePipeline(pipeline: WorkflowPipeline): Promise<void> {
    let analysisData: FeatureAnalysis | undefined;

    for (const step of pipeline.steps) {
      if (pipeline.status === 'failed') break;

      step.status = 'running';
      this.emit('step:started', pipeline, step);

      try {
        const result = await this.executeStep(step, pipeline, analysisData);
        step.result = result;

        if (result.success) {
          step.status = 'completed';

          // Guardar dados da análise para uso posterior
          if (step.agent === 'analysis' && result.data) {
            analysisData = result.data as FeatureAnalysis;
          }

          this.emit('step:completed', pipeline, step);
        } else {
          step.status = 'failed';
          pipeline.status = 'failed';
          this.emit('step:failed', pipeline, step);
          break;
        }
      } catch (error) {
        step.status = 'failed';
        pipeline.status = 'failed';
        this.emit('step:failed', pipeline, step, error);
        break;
      }
    }

    if (pipeline.status !== 'failed') {
      pipeline.status = 'completed';
      pipeline.completedAt = new Date();
      this.emit('pipeline:completed', pipeline);
    }
  }

  private async executeStep(
    step: WorkflowStep,
    pipeline: WorkflowPipeline,
    analysisData?: FeatureAnalysis
  ): Promise<AgentResult> {
    const workspaceRoot = this.appConfig.workspace.root;

    switch (step.agent) {
      case 'git-setup': {
        const agent = new GitSetupAgent(this.appConfig);
        return agent.execute({
          featureId: pipeline.featureId,
          workspaceRoot,
          baseBranch: 'master',
        });
      }

      case 'analysis': {
        const agent = new AnalysisAgent(this.azureService, this.appConfig);
        const result = await agent.execute({ featureId: pipeline.featureId });

        // Após análise, solicitar aprovação
        if (result.success) {
          step.status = 'awaiting-approval';
          const approved = await this.requestApproval(
            pipeline,
            step.id,
            'Análise concluída. Deseja aprovar e prosseguir com a implementação?',
            result.data
          );

          if (!approved) {
            return {
              ...result,
              success: false,
              message: 'Análise rejeitada pelo usuário',
            };
          }
        }

        return result;
      }

      case 'task-executor': {
        if (!analysisData) throw new Error('Dados de análise não disponíveis');

        const agent = new TaskExecutorAgent(this.azureService, this.appConfig);
        let lastResult: AgentResult | undefined;

        for (const task of analysisData.tasks) {
          lastResult = await agent.execute({
            task,
            workspaceRoot,
            relevantFiles: analysisData.codebaseContext.relevantFiles,
          });

          if (!lastResult.success) break;
        }

        return lastResult || {
          agent: 'task-executor',
          success: true,
          message: 'Nenhuma task para executar',
          logs: [],
          duration: 0,
        };
      }

      case 'build': {
        if (!analysisData) throw new Error('Dados de análise não disponíveis');

        const agent = new BuildAgent(this.appConfig);
        return agent.execute({
          projects: analysisData.codebaseContext.projects,
          workspaceRoot,
        });
      }

      case 'test': {
        if (!analysisData) throw new Error('Dados de análise não disponíveis');

        const agent = new TestAgent(this.appConfig);
        return agent.execute({
          testType: 'all',
          projects: analysisData.codebaseContext.projects,
          workspaceRoot,
        });
      }

      case 'runner': {
        if (!analysisData) throw new Error('Dados de análise não disponíveis');

        const agent = new RunnerAgent(this.appConfig);
        const result = await agent.execute({
          projects: analysisData.codebaseContext.projects,
          workspaceRoot,
        });

        // Após validação local, solicitar aprovação para PR
        if (result.success) {
          step.status = 'awaiting-approval';
          const approved = await this.requestApproval(
            pipeline,
            step.id,
            'Validação local concluída com sucesso. Deseja criar o Pull Request?',
            result.data
          );

          if (!approved) {
            return {
              ...result,
              success: false,
              message: 'Criação de PR rejeitada pelo usuário',
            };
          }
        }

        return result;
      }

      case 'pull-request': {
        if (!analysisData) throw new Error('Dados de análise não disponíveis');

        const agent = new PullRequestAgent(this.appConfig);
        // Branch já foi criada pelo GitSetupAgent: feature/{featureId}
        const branchName = `feature/${pipeline.featureId}`;

        return agent.execute({
          feature: analysisData.feature,
          tasks: analysisData.tasks,
          sourceBranch: branchName,
          workspaceRoot,
          isDraft: true,
        });
      }

      case 'documentation': {
        if (!analysisData) throw new Error('Dados de análise não disponíveis');

        // Buscar resultado do PR de desenvolvimento do step anterior
        const prStep = pipeline.steps.find((s) => s.agent === 'pull-request');
        const devPR = prStep?.result?.data as import('../types/index.js').PullRequestResult | undefined;

        if (!devPR) {
          throw new Error('Resultado do PR de desenvolvimento não disponível');
        }

        const docAgent = new DocumentationAgent(this.appConfig);
        return docAgent.execute({
          feature: analysisData.feature,
          tasks: analysisData.tasks,
          analysisResult: analysisData,
          developmentPR: devPR,
        });
      }

      default:
        throw new Error(`Agente desconhecido: ${step.agent}`);
    }
  }

  private requestApproval(
    pipeline: WorkflowPipeline,
    stepId: string,
    message: string,
    data?: unknown
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const approvalId = randomUUID();

      const approval: ApprovalRequest = {
        id: approvalId,
        stepId,
        message,
        status: 'pending',
        data,
        requestedAt: new Date(),
      };

      pipeline.approvals.push(approval);
      this.pendingApprovals.set(approvalId, resolve);

      pipeline.status = 'paused';
      this.emit('approval:requested', pipeline, approval);
    });
  }

  private createSteps(): WorkflowStep[] {
    return [
      {
        id: randomUUID(),
        name: 'Preparação Git (fetch + pull + branch)',
        agent: 'git-setup',
        status: 'pending',
      },
      {
        id: randomUUID(),
        name: 'Análise da Feature',
        agent: 'analysis',
        status: 'pending',
        dependsOn: ['git-setup'],
      },
      {
        id: randomUUID(),
        name: 'Execução das Tasks',
        agent: 'task-executor',
        status: 'pending',
        dependsOn: ['analysis'],
      },
      {
        id: randomUUID(),
        name: 'Build dos Projetos',
        agent: 'build',
        status: 'pending',
        dependsOn: ['task-executor'],
      },
      {
        id: randomUUID(),
        name: 'Execução de Testes',
        agent: 'test',
        status: 'pending',
        dependsOn: ['build'],
      },
      {
        id: randomUUID(),
        name: 'Validação Local',
        agent: 'runner',
        status: 'pending',
        dependsOn: ['test'],
      },
      {
        id: randomUUID(),
        name: 'Criação do Pull Request',
        agent: 'pull-request',
        status: 'pending',
        dependsOn: ['runner'],
      },
      {
        id: randomUUID(),
        name: 'Documentação no docs-dracma',
        agent: 'documentation',
        status: 'pending',
        dependsOn: ['pull-request'],
      },
    ];
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }
}
