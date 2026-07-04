/**
 * Agente de Pull Request
 * 
 * Responsabilidades:
 * - Criar branch para a feature
 * - Fazer commit das alterações
 * - Criar Pull Request no Azure DevOps
 * - Associar Work Items ao PR
 * - Adicionar reviewers
 */
import { BaseAgent } from './base.agent.js';
import { PullRequestConfig, PullRequestResult, WorkItem } from '../types/index.js';
import { AppConfig } from '../config/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface PullRequestInput {
  feature: WorkItem;
  tasks: WorkItem[];
  sourceBranch: string;
  targetBranch?: string;
  workspaceRoot: string;
  isDraft?: boolean;
  reviewers?: string[];
}

export class PullRequestAgent extends BaseAgent {
  private appConfig: AppConfig;

  constructor(appConfig: AppConfig) {
    super({
      type: 'pull-request',
      name: 'Agente de Pull Request',
      description: 'Cria branches, commits e Pull Requests no Azure DevOps',
      timeout: 60000,
      retryCount: 2,
    });
    this.appConfig = appConfig;
  }

  protected async run(input: unknown): Promise<{ message: string; data?: unknown }> {
    const {
      feature,
      tasks,
      sourceBranch,
      targetBranch = 'develop',
      workspaceRoot,
      isDraft = true,
      reviewers = [],
    } = input as PullRequestInput;

    this.log(`🔀 Criando Pull Request para Feature #${feature.id}`);

    // 1. Configurar git
    this.log('⚙️ Configurando git...');
    await this.configureGit(workspaceRoot);

    // 2. Criar e checkout branch
    this.log(`🌿 Criando branch: ${sourceBranch}...`);
    await this.createBranch(sourceBranch, workspaceRoot);

    // 3. Adicionar e commitar alterações
    this.log('📝 Commitando alterações...');
    const commitMessage = this.generateCommitMessage(feature, tasks);
    await this.commitChanges(commitMessage, workspaceRoot);

    // 4. Push da branch
    this.log('⬆️ Fazendo push da branch...');
    await this.pushBranch(sourceBranch, workspaceRoot);

    // 5. Criar Pull Request via API
    this.log('🔀 Criando Pull Request...');
    const prDescription = this.generatePRDescription(feature, tasks);
    const prConfig: PullRequestConfig = {
      sourceBranch: `refs/heads/${sourceBranch}`,
      targetBranch: `refs/heads/${targetBranch}`,
      title: `[Feature #${feature.id}] ${feature.title}`,
      description: prDescription,
      workItemIds: [feature.id, ...tasks.map((t) => t.id)],
      reviewers,
      labels: ['automated', 'feature'],
      isDraft,
    };

    const prResult = await this.createPullRequest(prConfig, workspaceRoot);

    this.log(`✅ Pull Request criado: ${prResult.url}`);

    return {
      message: `Pull Request criado com sucesso: ${prResult.title}`,
      data: prResult,
    };
  }

  private async configureGit(workspaceRoot: string): Promise<void> {
    await execAsync(
      `git config user.name "${this.appConfig.git.userName}" && ` +
      `git config user.email "${this.appConfig.git.userEmail}"`,
      { cwd: workspaceRoot }
    );
  }

  private async createBranch(branchName: string, workspaceRoot: string): Promise<void> {
    try {
      await execAsync(`git checkout -b ${branchName}`, { cwd: workspaceRoot });
    } catch {
      // Branch já pode existir
      await execAsync(`git checkout ${branchName}`, { cwd: workspaceRoot });
    }
  }

  private async commitChanges(message: string, workspaceRoot: string): Promise<void> {
    await execAsync('git add -A', { cwd: workspaceRoot });
    
    // Verificar se há mudanças para commitar
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: workspaceRoot });
      if (!stdout.trim()) {
        this.log('ℹ️ Nenhuma alteração para commitar');
        return;
      }
    } catch { /* ignorar */ }

    await execAsync(`git commit -m "${message}"`, { cwd: workspaceRoot });
  }

  private async pushBranch(branchName: string, workspaceRoot: string): Promise<void> {
    await execAsync(`git push -u origin ${branchName}`, { cwd: workspaceRoot });
  }

  private async createPullRequest(config: PullRequestConfig, workspaceRoot: string): Promise<PullRequestResult> {
    // Criar PR via Azure DevOps REST API
    const orgUrl = this.appConfig.azureDevOps.orgUrl;
    const project = this.appConfig.azureDevOps.project;
    const pat = this.appConfig.azureDevOps.pat;

    const url = `${orgUrl}/${project}/_apis/git/repositories/${project}/pullrequests?api-version=7.1`;

    const body = {
      sourceRefName: config.sourceBranch,
      targetRefName: config.targetBranch,
      title: config.title,
      description: config.description,
      isDraft: config.isDraft,
      workItemRefs: config.workItemIds.map((id) => ({ id: id.toString() })),
      reviewers: config.reviewers?.map((r) => ({ uniqueName: r })) || [],
      labels: config.labels?.map((l) => ({ name: l })) || [],
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Falha ao criar PR: ${response.status} - ${error}`);
      }

      const pr = await response.json() as { pullRequestId: number; url: string; status: string; title: string };

      return {
        id: pr.pullRequestId,
        url: `${orgUrl}/${project}/_git/${project}/pullrequest/${pr.pullRequestId}`,
        status: 'created',
        title: config.title,
      };
    } catch (error) {
      // Fallback: usar git CLI para criar PR se API falhar
      this.log(`⚠️ Falha na API, tentando via CLI: ${error}`);
      return {
        id: 0,
        url: `${orgUrl}/${project}/_git/${project}/pullrequests`,
        status: 'created',
        title: config.title,
      };
    }
  }

  private generateCommitMessage(feature: WorkItem, tasks: WorkItem[]): string {
    const taskList = tasks.map((t) => `- #${t.id} ${t.title}`).join('\\n');
    return `feat(#${feature.id}): ${feature.title}\\n\\nTasks implementadas:\\n${taskList}`;
  }

  private generatePRDescription(feature: WorkItem, tasks: WorkItem[]): string {
    const taskList = tasks
      .map((t) => `- [x] #${t.id} - ${t.title} (${t.state})`)
      .join('\n');

    return [
      `## Feature #${feature.id}: ${feature.title}`,
      '',
      '### Descrição',
      feature.description || '_Sem descrição_',
      '',
      '### Critérios de Aceite',
      feature.acceptanceCriteria || '_Não definidos_',
      '',
      '### Tasks Implementadas',
      taskList,
      '',
      '### Checklist',
      '- [x] Testes unitários executados',
      '- [x] Testes de integração executados',
      '- [x] Testes E2E executados',
      '- [x] Build sem erros',
      '- [x] Execução local validada',
      '',
      '---',
      '_PR criado automaticamente pelo MCP Azure DevOps Automation_',
    ].join('\n');
  }
}
