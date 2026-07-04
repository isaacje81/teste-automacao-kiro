/**
 * Agente de Build
 * 
 * Responsabilidades:
 * - Executar build dos projetos (.NET, Node.js)
 * - Reportar erros e warnings de compilação
 * - Garantir que o código compila sem erros
 */
import { BaseAgent } from './base.agent.js';
import { BuildResult, ProjectInfo } from '../types/index.js';
import { AppConfig } from '../config/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface BuildInput {
  projects: ProjectInfo[];
  workspaceRoot: string;
  configuration?: string;
}

export class BuildAgent extends BaseAgent {
  private appConfig: AppConfig;

  constructor(appConfig: AppConfig) {
    super({
      type: 'build',
      name: 'Agente de Build',
      description: 'Executa build e compilação dos projetos',
      timeout: 180000, // 3 minutos
      retryCount: 2,
    });
    this.appConfig = appConfig;
  }

  protected async run(input: unknown): Promise<{ message: string; data?: unknown }> {
    const { projects, workspaceRoot, configuration } = input as BuildInput;
    const buildConfig = configuration || this.appConfig.build.configuration;

    this.log(`🔨 Iniciando build de ${projects.length} projeto(s)...`);
    this.log(`⚙️ Configuração: ${buildConfig}`);

    const results: BuildResult[] = [];
    let allSuccess = true;

    for (const project of projects) {
      this.checkTimeout();
      this.log(`\n📦 Buildando projeto: ${project.name} (${project.type})`);

      const result = await this.buildProject(project, workspaceRoot, buildConfig);
      results.push(result);

      if (result.success) {
        this.log(`✅ ${project.name}: Build OK (${result.duration}ms, ${result.warnings.length} warnings)`);
      } else {
        allSuccess = false;
        this.log(`❌ ${project.name}: Build FALHOU (${result.errors.length} erros)`);
        for (const error of result.errors.slice(0, 5)) {
          this.log(`   → ${error}`);
        }
      }
    }

    const summary = {
      totalProjects: projects.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      totalWarnings: results.reduce((sum, r) => sum + r.warnings.length, 0),
      totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
      results,
    };

    if (!allSuccess) {
      throw new Error(
        `Build falhou em ${summary.failed} projeto(s). Erros: ${summary.totalErrors}`
      );
    }

    return {
      message: `Build concluído com sucesso: ${summary.successful}/${summary.totalProjects} projetos compilados`,
      data: summary,
    };
  }

  private async buildProject(
    project: ProjectInfo,
    workspaceRoot: string,
    configuration: string
  ): Promise<BuildResult> {
    const startTime = Date.now();
    let command: string;

    // Determinar comando de build baseado no tipo de projeto
    if (project.path.endsWith('.csproj')) {
      command = `dotnet build "${project.path}" --configuration ${configuration} --no-incremental`;
    } else if (project.path.endsWith('package.json')) {
      const projectDir = project.path.replace('/package.json', '');
      command = `cd "${projectDir}" && npm run build`;
    } else {
      return {
        success: false,
        project: project.name,
        output: '',
        errors: [`Tipo de projeto não suportado: ${project.path}`],
        warnings: [],
        duration: 0,
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspaceRoot,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const output = `${stdout}\n${stderr}`;
      const errors = this.extractErrors(output);
      const warnings = this.extractWarnings(output);

      return {
        success: errors.length === 0,
        project: project.name,
        output,
        errors,
        warnings,
        duration: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const output = `${err.stdout || ''}\n${err.stderr || ''}`;

      return {
        success: false,
        project: project.name,
        output,
        errors: this.extractErrors(output) || [err.message || 'Erro desconhecido no build'],
        warnings: this.extractWarnings(output),
        duration: Date.now() - startTime,
      };
    }
  }

  private extractErrors(output: string): string[] {
    const errors: string[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.includes(': error ') || line.includes('Error:') || line.includes('FAILED')) {
        errors.push(line.trim());
      }
    }

    return errors;
  }

  private extractWarnings(output: string): string[] {
    const warnings: string[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.includes(': warning ') || line.includes('Warning:')) {
        warnings.push(line.trim());
      }
    }

    return warnings;
  }
}
