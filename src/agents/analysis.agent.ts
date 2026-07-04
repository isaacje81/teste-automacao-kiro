/**
 * Agente de Análise Refinada
 * 
 * Responsabilidades:
 * - Buscar a Feature no Azure DevOps
 * - Analisar o codebase especificado na feature
 * - Identificar áreas impactadas
 * - Gerar plano de implementação
 * - Solicitar aprovação do usuário
 */
import { BaseAgent } from './base.agent.js';
import { AzureDevOpsService } from '../services/azure-devops.service.js';
import {
  WorkItem,
  FeatureAnalysis,
  CodebaseContext,
  AnalysisResult,
  ImpactedArea,
  ProjectInfo,
} from '../types/index.js';
import { AppConfig } from '../config/index.js';
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname, basename } from 'path';
import { glob } from 'glob';

interface AnalysisInput {
  featureId: number;
}

export class AnalysisAgent extends BaseAgent {
  private azureService: AzureDevOpsService;
  private appConfig: AppConfig;

  constructor(azureService: AzureDevOpsService, appConfig: AppConfig) {
    super({
      type: 'analysis',
      name: 'Agente de Análise Refinada',
      description: 'Analisa features do Azure DevOps e mapeia impacto no codebase',
      timeout: 60000,
      retryCount: 2,
    });
    this.azureService = azureService;
    this.appConfig = appConfig;
  }

  protected async run(input: unknown): Promise<{ message: string; data?: unknown }> {
    const { featureId } = input as AnalysisInput;

    // 1. Buscar Feature e seus filhos
    this.log(`📋 Buscando Feature #${featureId} no Azure DevOps...`);
    const feature = await this.azureService.getFeature(featureId);
    this.log(`✓ Feature encontrada: "${feature.title}" (Estado: ${feature.state})`);

    // 2. Buscar Tasks e Test Cases
    this.log('📑 Buscando tasks e test cases associados...');
    const tasks = await this.azureService.getFeatureTasks(featureId);
    const testCases = await this.azureService.getFeatureTestCases(featureId);
    const testTasks = await this.azureService.getFeatureTestTasks(featureId);

    this.log(`✓ Encontradas ${tasks.length} tasks, ${testCases.length} test cases, ${testTasks.length} tasks de teste`);

    // 3. Analisar o codebase
    this.log('🔍 Analisando codebase...');
    const codebaseContext = await this.analyzeCodebase(feature);
    this.log(`✓ Codebase analisado: ${codebaseContext.projects.length} projetos, ${codebaseContext.relevantFiles.length} arquivos relevantes`);

    // 4. Gerar análise refinada
    this.log('🧠 Gerando análise refinada...');
    const analysisResult = await this.generateAnalysis(feature, tasks, codebaseContext);
    this.log(`✓ Análise gerada: complexidade ${analysisResult.estimatedComplexity}, ${analysisResult.impactedAreas.length} áreas impactadas`);

    const analysis: FeatureAnalysis = {
      feature,
      tasks,
      testCases,
      testTasks,
      codebaseContext,
      analysisResult,
    };

    return {
      message: `Análise da Feature #${featureId} "${feature.title}" concluída com sucesso`,
      data: analysis,
    };
  }

  /**
   * Analisa o codebase baseado nas informações da Feature
   */
  private async analyzeCodebase(feature: WorkItem): Promise<CodebaseContext> {
    const workspaceRoot = this.appConfig.workspace.root;
    const solutionPath = this.appConfig.workspace.solutionPath;

    // Descobrir projetos na solução
    const projects = await this.discoverProjects(workspaceRoot);

    // Identificar arquivos relevantes baseado na descrição da feature
    const relevantFiles = await this.findRelevantFiles(
      workspaceRoot,
      feature.title,
      feature.description,
      feature.tags || []
    );

    // Identificar dependências
    const dependencies = await this.discoverDependencies(workspaceRoot);

    return {
      solutionPath,
      projects,
      relevantFiles,
      dependencies,
    };
  }

  /**
   * Descobre projetos no workspace
   */
  private async discoverProjects(root: string): Promise<ProjectInfo[]> {
    const projects: ProjectInfo[] = [];

    try {
      // Buscar projetos .NET (.csproj)
      const csprojFiles = await glob('**/*.csproj', {
        cwd: root,
        ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**'],
      });

      for (const csproj of csprojFiles) {
        const fullPath = join(root, csproj);
        const content = await readFile(fullPath, 'utf-8');
        const name = basename(csproj, '.csproj');
        const type = this.inferProjectType(name, content);

        projects.push({
          name,
          path: csproj,
          type,
          framework: this.extractFramework(content),
          references: this.extractReferences(content),
        });
      }

      // Buscar projetos Node.js (package.json em subdiretórios)
      const packageFiles = await glob('**/package.json', {
        cwd: root,
        ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', 'package.json'],
      });

      for (const pkg of packageFiles) {
        const fullPath = join(root, pkg);
        const content = JSON.parse(await readFile(fullPath, 'utf-8'));
        const name = content.name || basename(pkg);

        projects.push({
          name,
          path: pkg,
          type: this.inferNodeProjectType(content),
          framework: content.dependencies?.['next'] ? 'Next.js' : 
                    content.dependencies?.['react'] ? 'React' : 
                    content.dependencies?.['express'] ? 'Express' : undefined,
          references: Object.keys(content.dependencies || {}),
        });
      }
    } catch (error) {
      this.log(`⚠️ Erro ao descobrir projetos: ${error}`);
    }

    return projects;
  }

  /**
   * Encontra arquivos relevantes baseado em palavras-chave da Feature
   */
  private async findRelevantFiles(
    root: string,
    title: string,
    description: string,
    tags: string[]
  ): Promise<string[]> {
    const keywords = this.extractKeywords(title, description, tags);
    const relevantFiles: string[] = [];

    try {
      const sourceFiles = await glob('**/*.{cs,ts,tsx,js,jsx}', {
        cwd: root,
        ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**'],
      });

      for (const file of sourceFiles) {
        const fileName = basename(file).toLowerCase();
        const isRelevant = keywords.some(
          (keyword) =>
            fileName.includes(keyword.toLowerCase()) ||
            file.toLowerCase().includes(keyword.toLowerCase())
        );

        if (isRelevant) {
          relevantFiles.push(file);
        }
      }
    } catch (error) {
      this.log(`⚠️ Erro ao buscar arquivos relevantes: ${error}`);
    }

    return relevantFiles.slice(0, 50); // Limitar para não sobrecarregar
  }

  /**
   * Descobre dependências do projeto
   */
  private async discoverDependencies(root: string): Promise<string[]> {
    const deps: string[] = [];

    try {
      // Ler global.json se existir
      const globalJsonPath = join(root, 'global.json');
      try {
        const globalJson = JSON.parse(await readFile(globalJsonPath, 'utf-8'));
        if (globalJson.sdk?.version) {
          deps.push(`.NET SDK ${globalJson.sdk.version}`);
        }
      } catch { /* arquivo não existe */ }

      // Ler package.json raiz se existir
      const packageJsonPath = join(root, 'package.json');
      try {
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };
        for (const [name, version] of Object.entries(allDeps)) {
          deps.push(`${name}@${version}`);
        }
      } catch { /* arquivo não existe */ }
    } catch (error) {
      this.log(`⚠️ Erro ao descobrir dependências: ${error}`);
    }

    return deps;
  }

  /**
   * Gera a análise refinada
   */
  private async generateAnalysis(
    feature: WorkItem,
    tasks: WorkItem[],
    codebase: CodebaseContext
  ): Promise<AnalysisResult> {
    const impactedAreas: ImpactedArea[] = [];

    // Mapear áreas impactadas por projeto
    for (const project of codebase.projects) {
      const relevantForProject = codebase.relevantFiles.filter((f) =>
        f.startsWith(project.path.replace(basename(project.path), ''))
      );

      if (relevantForProject.length > 0) {
        impactedAreas.push({
          project: project.name,
          files: relevantForProject,
          description: `Modificações necessárias no projeto ${project.name} (${project.type})`,
          changeType: 'modify',
        });
      }
    }

    // Avaliar complexidade
    const complexity = this.assessComplexity(feature, tasks, codebase);

    // Gerar abordagem sugerida
    const suggestedApproach = this.generateApproach(feature, tasks, impactedAreas);

    // Identificar riscos
    const risks = this.identifyRisks(feature, codebase, impactedAreas);

    // Gerar mudanças necessárias
    const requiredChanges = codebase.relevantFiles.map((file, index) => ({
      file,
      description: `Atualizar ${basename(file)} conforme requisitos da feature`,
      type: 'modify' as const,
      priority: index + 1,
    }));

    return {
      summary: `Feature "${feature.title}" requer modificações em ${impactedAreas.length} áreas do projeto. ` +
        `Complexidade estimada: ${complexity}. Total de ${tasks.length} tasks para implementação.`,
      impactedAreas,
      suggestedApproach,
      risks,
      estimatedComplexity: complexity,
      requiredChanges,
    };
  }

  // ============================================================
  // Helpers de análise
  // ============================================================

  private extractKeywords(title: string, description: string, tags: string[]): string[] {
    const words = `${title} ${description}`
      .replace(/<[^>]*>/g, '') // Remover HTML
      .split(/[\s,;.!?()[\]{}]+/)
      .filter((w) => w.length > 3)
      .map((w) => w.toLowerCase());

    // Adicionar tags
    const allWords = [...words, ...tags.map((t) => t.toLowerCase())];

    // Remover palavras comuns
    const stopWords = ['para', 'como', 'deve', 'quando', 'então', 'dado', 'the', 'and', 'with'];
    return [...new Set(allWords.filter((w) => !stopWords.includes(w)))];
  }

  private inferProjectType(name: string, content: string): ProjectInfo['type'] {
    const nameLower = name.toLowerCase();
    if (nameLower.includes('test') || nameLower.includes('tests')) return 'test';
    if (nameLower.includes('api') || content.includes('Microsoft.NET.Sdk.Web')) return 'api';
    if (nameLower.includes('web') || content.includes('Microsoft.NET.Sdk.Web')) return 'web';
    if (content.includes('Exe')) return 'console';
    return 'library';
  }

  private inferNodeProjectType(pkg: Record<string, unknown>): ProjectInfo['type'] {
    const deps = pkg.dependencies as Record<string, string> | undefined;
    if (deps?.['express'] || deps?.['fastify'] || deps?.['koa']) return 'api';
    if (deps?.['react'] || deps?.['vue'] || deps?.['angular']) return 'web';
    if (deps?.['jest'] || deps?.['vitest'] || deps?.['mocha']) return 'test';
    return 'library';
  }

  private extractFramework(csprojContent: string): string | undefined {
    const match = csprojContent.match(/<TargetFramework>(.*?)<\/TargetFramework>/);
    return match?.[1];
  }

  private extractReferences(csprojContent: string): string[] {
    const refs: string[] = [];
    const packageRefs = csprojContent.matchAll(/<PackageReference Include="([^"]+)"/g);
    for (const match of packageRefs) {
      refs.push(match[1]);
    }
    const projectRefs = csprojContent.matchAll(/<ProjectReference Include="([^"]+)"/g);
    for (const match of projectRefs) {
      refs.push(match[1]);
    }
    return refs;
  }

  private assessComplexity(
    feature: WorkItem,
    tasks: WorkItem[],
    codebase: CodebaseContext
  ): 'low' | 'medium' | 'high' {
    let score = 0;
    
    // Mais tasks = mais complexo
    if (tasks.length > 5) score += 3;
    else if (tasks.length > 2) score += 1;

    // Mais projetos impactados = mais complexo
    if (codebase.projects.length > 3) score += 2;
    else if (codebase.projects.length > 1) score += 1;

    // Mais arquivos relevantes = mais complexo
    if (codebase.relevantFiles.length > 20) score += 3;
    else if (codebase.relevantFiles.length > 10) score += 2;
    else if (codebase.relevantFiles.length > 5) score += 1;

    if (score >= 5) return 'high';
    if (score >= 3) return 'medium';
    return 'low';
  }

  private generateApproach(
    feature: WorkItem,
    tasks: WorkItem[],
    impactedAreas: ImpactedArea[]
  ): string[] {
    const approach: string[] = [];

    approach.push(`1. Criar branch feature/${feature.id}-${this.slugify(feature.title)}`);

    for (let i = 0; i < tasks.length; i++) {
      approach.push(`${i + 2}. Implementar task: "${tasks[i].title}"`);
    }

    approach.push(`${tasks.length + 2}. Executar testes unitários`);
    approach.push(`${tasks.length + 3}. Executar testes de integração`);
    approach.push(`${tasks.length + 4}. Executar testes end-to-end`);
    approach.push(`${tasks.length + 5}. Build completo do projeto`);
    approach.push(`${tasks.length + 6}. Validação local`);
    approach.push(`${tasks.length + 7}. Criar Pull Request`);

    return approach;
  }

  private identifyRisks(
    feature: WorkItem,
    codebase: CodebaseContext,
    impactedAreas: ImpactedArea[]
  ): AnalysisResult['risks'] {
    const risks: AnalysisResult['risks'] = [];

    if (impactedAreas.length > 3) {
      risks.push({
        description: 'Múltiplas áreas do projeto serão impactadas, aumentando chance de regressão',
        severity: 'medium',
        mitigation: 'Executar suite completa de testes de regressão',
      });
    }

    const testProjects = codebase.projects.filter((p) => p.type === 'test');
    if (testProjects.length === 0) {
      risks.push({
        description: 'Não foram identificados projetos de teste no workspace',
        severity: 'high',
        mitigation: 'Criar testes unitários antes da implementação (TDD)',
      });
    }

    if (!feature.acceptanceCriteria) {
      risks.push({
        description: 'Feature sem critérios de aceite definidos',
        severity: 'medium',
        mitigation: 'Definir critérios de aceite antes de iniciar implementação',
      });
    }

    return risks;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }
}
