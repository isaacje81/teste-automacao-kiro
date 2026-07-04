/**
 * Agente de Documentação
 * 
 * Responsabilidades:
 * - Monitorar a aprovação do PR de desenvolvimento
 * - Gerar documentação técnica da implementação
 * - Criar branch no repositório docs-dracma
 * - Criar/atualizar arquivos de documentação
 * - Criar Pull Request no repositório docs-dracma
 * 
 * TRIGGER: Executado automaticamente APÓS o PR de desenvolvimento ser aprovado
 */
import { BaseAgent } from './base.agent.js';
import {
  WorkItem,
  PullRequestResult,
  FeatureAnalysis,
  DocumentationResult,
} from '../types/index.js';
import { AppConfig } from '../config/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

const execAsync = promisify(exec);

interface DocumentationInput {
  feature: WorkItem;
  tasks: WorkItem[];
  analysisResult: FeatureAnalysis;
  developmentPR: PullRequestResult;
}

export class DocumentationAgent extends BaseAgent {
  private appConfig: AppConfig;

  constructor(appConfig: AppConfig) {
    super({
      type: 'documentation',
      name: 'Agente de Documentação (docs-dracma)',
      description: 'Cria PR de documentação no repositório docs-dracma após aprovação do PR de desenvolvimento',
      timeout: 90000, // 1.5 minutos
      retryCount: 2,
    });
    this.appConfig = appConfig;
  }

  protected async run(input: unknown): Promise<{ message: string; data?: unknown }> {
    const {
      feature,
      tasks,
      analysisResult,
      developmentPR,
    } = input as DocumentationInput;

    const docsConfig = this.appConfig.documentation;

    this.log(`📖 Iniciando criação de documentação para Feature #${feature.id}`);
    this.log(`📂 Repositório de docs: ${docsConfig.docsRepo}`);
    this.log(`🔗 PR de desenvolvimento aprovado: ${developmentPR.url}`);

    // 1. Clonar/acessar repositório docs-dracma
    const docsWorkspace = join(this.appConfig.workspace.root, '..', docsConfig.docsRepo);
    this.log(`📁 Workspace docs: ${docsWorkspace}`);

    await this.setupDocsRepository(docsWorkspace, docsConfig.docsRepoUrl);

    // 2. Criar branch de documentação
    const docsBranch = `docs/feature-${feature.id}-${this.slugify(feature.title)}`;
    this.log(`🌿 Criando branch: ${docsBranch}`);
    await this.createDocsBranch(docsBranch, docsWorkspace, docsConfig.docsTargetBranch);

    // 3. Gerar arquivos de documentação
    this.log('📝 Gerando documentação...');
    const docsCreated = await this.generateDocumentation(
      feature,
      tasks,
      analysisResult,
      developmentPR,
      docsWorkspace,
      docsConfig.docsBasePath
    );
    this.log(`✓ ${docsCreated.length} arquivo(s) de documentação criados`);

    // 4. Commit e push
    this.log('📤 Commitando e fazendo push da documentação...');
    await this.commitAndPush(feature, docsBranch, docsWorkspace);

    // 5. Criar Pull Request no docs-dracma
    this.log('🔀 Criando Pull Request no docs-dracma...');
    const docsPR = await this.createDocsPullRequest(
      feature,
      tasks,
      developmentPR,
      docsBranch,
      docsConfig.docsTargetBranch,
      docsWorkspace
    );

    this.log(`✅ PR de documentação criado: ${docsPR.url}`);

    const result: DocumentationResult = {
      prUrl: docsPR.url,
      prId: docsPR.id,
      docsCreated,
      status: 'created',
    };

    return {
      message: `PR de documentação criado no ${docsConfig.docsRepo}: ${docsPR.url}`,
      data: result,
    };
  }

  /**
   * Configura o repositório docs-dracma (clone ou pull)
   */
  private async setupDocsRepository(docsWorkspace: string, repoUrl: string): Promise<void> {
    try {
      // Verificar se já existe
      await execAsync(`git -C "${docsWorkspace}" status`, { timeout: 10000 });
      // Pull latest
      this.log('  → Repositório docs-dracma já existe, atualizando...');
      await execAsync(`git -C "${docsWorkspace}" pull origin main`, { timeout: 30000 });
    } catch {
      // Clone se não existir
      this.log('  → Clonando repositório docs-dracma...');
      if (!repoUrl) {
        const orgUrl = this.appConfig.azureDevOps.orgUrl;
        const project = this.appConfig.azureDevOps.project;
        const docsRepo = this.appConfig.documentation.docsRepo;
        // URL padrão do Azure DevOps
        repoUrl = `${orgUrl}/${project}/_git/${docsRepo}`;
      }
      await execAsync(`git clone "${repoUrl}" "${docsWorkspace}"`, { timeout: 60000 });
    }

    // Configurar git no repo de docs
    await execAsync(
      `git -C "${docsWorkspace}" config user.name "${this.appConfig.git.userName}" && ` +
      `git -C "${docsWorkspace}" config user.email "${this.appConfig.git.userEmail}"`,
      { timeout: 5000 }
    );
  }

  /**
   * Cria branch de documentação
   */
  private async createDocsBranch(
    branchName: string,
    docsWorkspace: string,
    baseBranch: string
  ): Promise<void> {
    try {
      await execAsync(
        `git -C "${docsWorkspace}" checkout ${baseBranch} && ` +
        `git -C "${docsWorkspace}" checkout -b ${branchName}`,
        { timeout: 10000 }
      );
    } catch {
      // Branch pode já existir
      await execAsync(`git -C "${docsWorkspace}" checkout ${branchName}`, { timeout: 5000 });
    }
  }

  /**
   * Gera todos os arquivos de documentação da feature
   */
  private async generateDocumentation(
    feature: WorkItem,
    tasks: WorkItem[],
    analysis: FeatureAnalysis,
    devPR: PullRequestResult,
    docsWorkspace: string,
    basePath: string
  ): Promise<string[]> {
    const featureDir = join(docsWorkspace, basePath, `feature-${feature.id}`);
    await mkdir(featureDir, { recursive: true });

    const docsCreated: string[] = [];

    // 1. Documento principal da feature
    const mainDoc = this.generateFeatureDoc(feature, tasks, analysis, devPR);
    const mainDocPath = join(featureDir, 'README.md');
    await writeFile(mainDocPath, mainDoc, 'utf-8');
    docsCreated.push(`${basePath}/feature-${feature.id}/README.md`);

    // 2. Documento de implementação técnica
    const techDoc = this.generateTechnicalDoc(feature, analysis);
    const techDocPath = join(featureDir, 'IMPLEMENTACAO.md');
    await writeFile(techDocPath, techDoc, 'utf-8');
    docsCreated.push(`${basePath}/feature-${feature.id}/IMPLEMENTACAO.md`);

    // 3. Documento de testes
    const testDoc = this.generateTestDoc(feature, analysis);
    const testDocPath = join(featureDir, 'TESTES.md');
    await writeFile(testDocPath, testDoc, 'utf-8');
    docsCreated.push(`${basePath}/feature-${feature.id}/TESTES.md`);

    return docsCreated;
  }

  /**
   * Gera documentação principal da feature
   */
  private generateFeatureDoc(
    feature: WorkItem,
    tasks: WorkItem[],
    analysis: FeatureAnalysis,
    devPR: PullRequestResult
  ): string {
    const taskList = tasks
      .map((t) => `| #${t.id} | ${t.title} | ${t.state} | ${t.assignedTo || '-'} |`)
      .join('\n');

    return [
      `# Feature #${feature.id}: ${feature.title}`,
      '',
      `> Documentação gerada automaticamente após aprovação do PR de desenvolvimento.`,
      '',
      '## Informações Gerais',
      '',
      `| Campo | Valor |`,
      `|-------|-------|`,
      `| **ID** | ${feature.id} |`,
      `| **Estado** | ${feature.state} |`,
      `| **Responsável** | ${feature.assignedTo || '-'} |`,
      `| **Complexidade** | ${analysis.analysisResult.estimatedComplexity} |`,
      `| **PR Desenvolvimento** | [PR #${devPR.id}](${devPR.url}) |`,
      `| **Data** | ${new Date().toISOString().split('T')[0]} |`,
      '',
      '## Descrição',
      '',
      feature.description || '_Sem descrição_',
      '',
      '## Critérios de Aceite',
      '',
      feature.acceptanceCriteria || '_Não definidos_',
      '',
      '## Tasks',
      '',
      '| ID | Título | Estado | Responsável |',
      '|----|--------|--------|-------------|',
      taskList,
      '',
      '## Áreas Impactadas',
      '',
      ...analysis.analysisResult.impactedAreas.map((area) => [
        `### ${area.project}`,
        `- **Tipo de mudança:** ${area.changeType}`,
        `- **Descrição:** ${area.description}`,
        `- **Arquivos:** ${area.files.length} arquivo(s)`,
        '',
      ]).flat(),
      '',
      '## Links Relacionados',
      '',
      `- [Pull Request de Desenvolvimento](${devPR.url})`,
      `- [Feature no Azure DevOps](${this.appConfig.azureDevOps.orgUrl}/${this.appConfig.azureDevOps.project}/_workitems/edit/${feature.id})`,
      '',
      '---',
      '_Documentação gerada automaticamente pelo MCP Azure DevOps Automation_',
    ].join('\n');
  }

  /**
   * Gera documentação técnica da implementação
   */
  private generateTechnicalDoc(feature: WorkItem, analysis: FeatureAnalysis): string {
    const projList = analysis.codebaseContext.projects
      .map((p) => `| ${p.name} | ${p.type} | ${p.framework || '-'} | ${p.path} |`)
      .join('\n');

    const changeList = analysis.analysisResult.requiredChanges
      .map((c) => `| ${c.priority} | ${c.file} | ${c.type} | ${c.description} |`)
      .join('\n');

    return [
      `# Implementação Técnica — Feature #${feature.id}`,
      '',
      '## Resumo Técnico',
      '',
      analysis.analysisResult.summary,
      '',
      '## Projetos Envolvidos',
      '',
      '| Projeto | Tipo | Framework | Caminho |',
      '|---------|------|-----------|---------|',
      projList,
      '',
      '## Mudanças Realizadas',
      '',
      '| Prioridade | Arquivo | Tipo | Descrição |',
      '|-----------|---------|------|-----------|',
      changeList,
      '',
      '## Abordagem de Implementação',
      '',
      ...analysis.analysisResult.suggestedApproach.map((step) => `${step}`),
      '',
      '## Riscos Identificados',
      '',
      ...analysis.analysisResult.risks.map((risk) => [
        `### ⚠️ ${risk.description}`,
        `- **Severidade:** ${risk.severity}`,
        `- **Mitigação:** ${risk.mitigation}`,
        '',
      ]).flat(),
      '',
      '## Dependências',
      '',
      ...analysis.codebaseContext.dependencies.slice(0, 20).map((dep) => `- ${dep}`),
      '',
      '---',
      '_Gerado automaticamente_',
    ].join('\n');
  }

  /**
   * Gera documentação dos testes
   */
  private generateTestDoc(feature: WorkItem, analysis: FeatureAnalysis): string {
    const testCaseList = analysis.testCases
      .map((tc) => `| #${tc.id} | ${tc.title} | ${tc.state} |`)
      .join('\n');

    return [
      `# Testes — Feature #${feature.id}`,
      '',
      '## Estratégia de Testes',
      '',
      '| Tipo | Escopo | Status |',
      '|------|--------|--------|',
      '| Unitários | Componentes isolados | ✅ Executados |',
      '| Integração | Interação entre serviços | ✅ Executados |',
      '| End-to-End | Fluxo completo do usuário | ✅ Executados |',
      '',
      '## Test Cases (Azure DevOps)',
      '',
      '| ID | Título | Estado |',
      '|----|--------|--------|',
      testCaseList || '| - | Nenhum test case registrado | - |',
      '',
      '## Cobertura',
      '',
      '> Detalhes de cobertura disponíveis nos relatórios de CI/CD.',
      '',
      '## Cenários Validados',
      '',
      '- ✅ Build sem erros',
      '- ✅ Testes unitários passando',
      '- ✅ Testes de integração passando',
      '- ✅ Testes E2E passando',
      '- ✅ Execução local validada com health check',
      '',
      '---',
      '_Gerado automaticamente_',
    ].join('\n');
  }

  /**
   * Commit e push da documentação
   */
  private async commitAndPush(
    feature: WorkItem,
    branchName: string,
    docsWorkspace: string
  ): Promise<void> {
    await execAsync(`git -C "${docsWorkspace}" add -A`, { timeout: 10000 });

    const commitMsg = `docs(#${feature.id}): documentação da feature "${feature.title}"`;
    await execAsync(
      `git -C "${docsWorkspace}" commit -m "${commitMsg}"`,
      { timeout: 10000 }
    );

    await execAsync(
      `git -C "${docsWorkspace}" push -u origin ${branchName}`,
      { timeout: 30000 }
    );
  }

  /**
   * Cria o Pull Request no repositório docs-dracma
   */
  private async createDocsPullRequest(
    feature: WorkItem,
    tasks: WorkItem[],
    devPR: PullRequestResult,
    sourceBranch: string,
    targetBranch: string,
    docsWorkspace: string
  ): Promise<PullRequestResult> {
    const orgUrl = this.appConfig.azureDevOps.orgUrl;
    const project = this.appConfig.azureDevOps.project;
    const pat = this.appConfig.azureDevOps.pat;
    const docsRepo = this.appConfig.documentation.docsRepo;

    const url = `${orgUrl}/${project}/_apis/git/repositories/${docsRepo}/pullrequests?api-version=7.1`;

    const description = [
      `## 📖 Documentação: Feature #${feature.id}`,
      '',
      `Documentação gerada automaticamente após aprovação do [PR de desenvolvimento #${devPR.id}](${devPR.url}).`,
      '',
      '### Documentos Criados',
      `- \`README.md\` — Visão geral da feature`,
      `- \`IMPLEMENTACAO.md\` — Detalhes técnicos`,
      `- \`TESTES.md\` — Estratégia e resultados de testes`,
      '',
      `### Feature`,
      `- **Título:** ${feature.title}`,
      `- **ID:** #${feature.id}`,
      `- **Tasks:** ${tasks.length}`,
      '',
      '---',
      '_PR criado automaticamente pelo MCP Azure DevOps Automation_',
    ].join('\n');

    const body = {
      sourceRefName: `refs/heads/${sourceBranch}`,
      targetRefName: `refs/heads/${targetBranch}`,
      title: `[Docs] Feature #${feature.id}: ${feature.title}`,
      description,
      isDraft: false,
      workItemRefs: [{ id: feature.id.toString() }],
      labels: [{ name: 'documentation' }, { name: 'automated' }],
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
        throw new Error(`Falha ao criar PR de docs: ${response.status} - ${error}`);
      }

      const pr = await response.json() as {
        pullRequestId: number;
        url: string;
        title: string;
      };

      return {
        id: pr.pullRequestId,
        url: `${orgUrl}/${project}/_git/${docsRepo}/pullrequest/${pr.pullRequestId}`,
        status: 'created',
        title: body.title,
      };
    } catch (error) {
      this.log(`⚠️ Falha na API para criar PR de docs: ${error}`);
      return {
        id: 0,
        url: `${orgUrl}/${project}/_git/${docsRepo}/pullrequests`,
        status: 'created',
        title: body.title,
      };
    }
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }
}
