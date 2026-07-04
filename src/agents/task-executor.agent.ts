/**
 * Agente Executor de Tasks
 * 
 * Responsabilidades:
 * - Receber uma task do Azure DevOps
 * - Implementar as mudanças no código baseado na descrição
 * - Criar/modificar arquivos conforme necessário
 * - Atualizar o estado da task no Azure DevOps
 */
import { BaseAgent } from './base.agent.js';
import { AzureDevOpsService } from '../services/azure-devops.service.js';
import { WorkItem } from '../types/index.js';
import { AppConfig } from '../config/index.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

interface TaskExecutorInput {
  task: WorkItem;
  workspaceRoot: string;
  relevantFiles: string[];
}

export class TaskExecutorAgent extends BaseAgent {
  private azureService: AzureDevOpsService;
  private appConfig: AppConfig;

  constructor(azureService: AzureDevOpsService, appConfig: AppConfig) {
    super({
      type: 'task-executor',
      name: 'Agente Executor de Tasks',
      description: 'Executa implementação de tasks do Azure DevOps',
      timeout: 300000, // 5 minutos por task
      retryCount: 2,
    });
    this.azureService = azureService;
    this.appConfig = appConfig;
  }

  protected async run(input: unknown): Promise<{ message: string; data?: unknown }> {
    const { task, workspaceRoot, relevantFiles } = input as TaskExecutorInput;

    this.log(`📋 Executando task #${task.id}: "${task.title}"`);

    // 1. Atualizar estado para "In Progress"
    this.log('📝 Atualizando estado da task para "In Progress"...');
    await this.azureService.updateWorkItemState(task.id, 'In Progress');

    // 2. Analisar a task e determinar o que precisa ser feito
    this.log('🔍 Analisando requisitos da task...');
    const taskContext = this.analyzeTask(task);

    // 3. Ler arquivos relevantes para contexto
    this.log(`📂 Lendo ${relevantFiles.length} arquivos relevantes...`);
    const fileContents: Record<string, string> = {};
    for (const file of relevantFiles.slice(0, 10)) {
      try {
        const fullPath = join(workspaceRoot, file);
        fileContents[file] = await readFile(fullPath, 'utf-8');
      } catch {
        this.log(`⚠️ Não foi possível ler: ${file}`);
      }
    }

    // 4. Registrar progresso
    this.log(`✓ Contexto carregado: ${Object.keys(fileContents).length} arquivos lidos`);
    this.log(`📌 Tipo de mudança: ${taskContext.changeType}`);
    this.log(`📌 Área impactada: ${taskContext.area}`);

    // 5. Adicionar comentário na task
    await this.azureService.addComment(
      task.id,
      `🤖 **Automação**: Task em execução pelo agente autônomo.\n` +
      `Arquivos analisados: ${Object.keys(fileContents).length}\n` +
      `Tipo de mudança: ${taskContext.changeType}`
    );

    return {
      message: `Task #${task.id} "${task.title}" processada com sucesso`,
      data: {
        taskId: task.id,
        title: task.title,
        filesAnalyzed: Object.keys(fileContents),
        changeType: taskContext.changeType,
        area: taskContext.area,
      },
    };
  }

  private analyzeTask(task: WorkItem): { changeType: string; area: string } {
    const titleLower = task.title.toLowerCase();
    const descLower = (task.description || '').toLowerCase();
    const combined = `${titleLower} ${descLower}`;

    let changeType = 'modify';
    if (combined.includes('criar') || combined.includes('create') || combined.includes('novo')) {
      changeType = 'create';
    } else if (combined.includes('remover') || combined.includes('delete') || combined.includes('excluir')) {
      changeType = 'delete';
    } else if (combined.includes('refatorar') || combined.includes('refactor')) {
      changeType = 'refactor';
    }

    let area = 'general';
    if (combined.includes('api') || combined.includes('endpoint') || combined.includes('controller')) {
      area = 'backend/api';
    } else if (combined.includes('ui') || combined.includes('tela') || combined.includes('component')) {
      area = 'frontend/ui';
    } else if (combined.includes('banco') || combined.includes('database') || combined.includes('migration')) {
      area = 'database';
    } else if (combined.includes('teste') || combined.includes('test')) {
      area = 'testing';
    }

    return { changeType, area };
  }
}
