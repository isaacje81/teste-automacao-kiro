/**
 * Agente de Execução Local (Runner)
 * 
 * Responsabilidades:
 * - Iniciar projetos localmente para validação
 * - Verificar se a aplicação sobe corretamente
 * - Executar health checks
 * - Validar endpoints básicos
 */
import { BaseAgent } from './base.agent.js';
import { ProjectInfo } from '../types/index.js';
import { AppConfig } from '../config/index.js';
import { exec, ChildProcess, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface RunnerInput {
  projects: ProjectInfo[];
  workspaceRoot: string;
  healthCheckUrl?: string;
  waitTimeMs?: number;
}

interface RunnerResult {
  projectsStarted: string[];
  healthCheckPassed: boolean;
  endpoints: EndpointCheck[];
}

interface EndpointCheck {
  url: string;
  status: number;
  responseTime: number;
  healthy: boolean;
}

export class RunnerAgent extends BaseAgent {
  private appConfig: AppConfig;
  private processes: ChildProcess[] = [];

  constructor(appConfig: AppConfig) {
    super({
      type: 'runner',
      name: 'Agente de Execução Local',
      description: 'Executa projetos localmente e valida funcionamento',
      timeout: 120000, // 2 minutos
      retryCount: 1,
    });
    this.appConfig = appConfig;
  }

  protected async run(input: unknown): Promise<{ message: string; data?: unknown }> {
    const {
      projects,
      workspaceRoot,
      healthCheckUrl,
      waitTimeMs = 15000,
    } = input as RunnerInput;

    this.log(`🚀 Iniciando execução local de ${projects.length} projeto(s)...`);

    const runnableProjects = projects.filter(
      (p) => p.type === 'api' || p.type === 'web' || p.type === 'console'
    );

    if (runnableProjects.length === 0) {
      this.log('⚠️ Nenhum projeto executável encontrado');
      return {
        message: 'Nenhum projeto executável encontrado para validação local',
        data: { projectsStarted: [], healthCheckPassed: true, endpoints: [] },
      };
    }

    const projectsStarted: string[] = [];

    try {
      // Iniciar cada projeto
      for (const project of runnableProjects) {
        this.log(`📦 Iniciando: ${project.name}...`);
        await this.startProject(project, workspaceRoot);
        projectsStarted.push(project.name);
        this.log(`✓ ${project.name} iniciado`);
      }

      // Aguardar projetos estabilizarem
      this.log(`⏳ Aguardando ${waitTimeMs}ms para estabilização...`);
      await this.sleep(waitTimeMs);

      // Executar health checks
      const baseUrl = healthCheckUrl || this.appConfig.test.e2eBaseUrl;
      this.log(`🏥 Executando health check em ${baseUrl}...`);
      const endpoints = await this.runHealthChecks(baseUrl);

      const allHealthy = endpoints.length === 0 || endpoints.every((e) => e.healthy);

      const result: RunnerResult = {
        projectsStarted,
        healthCheckPassed: allHealthy,
        endpoints,
      };

      if (!allHealthy) {
        const failedEndpoints = endpoints.filter((e) => !e.healthy);
        throw new Error(
          `Health check falhou em ${failedEndpoints.length} endpoint(s): ` +
          failedEndpoints.map((e) => `${e.url} (status: ${e.status})`).join(', ')
        );
      }

      return {
        message: `Execução local validada com sucesso: ${projectsStarted.length} projeto(s) rodando`,
        data: result,
      };
    } finally {
      // Parar todos os processos
      this.log('🛑 Parando processos...');
      await this.stopAll();
    }
  }

  private async startProject(project: ProjectInfo, workspaceRoot: string): Promise<void> {
    let command: string;
    let args: string[];

    if (project.path.endsWith('.csproj')) {
      command = 'dotnet';
      args = ['run', '--project', project.path, '--no-build'];
    } else {
      command = 'npm';
      args = ['start'];
    }

    const child = spawn(command, args, {
      cwd: workspaceRoot,
      detached: true,
      stdio: 'pipe',
    });

    this.processes.push(child);

    // Monitorar erros de inicialização
    child.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) this.log(`  [${project.name}] stderr: ${msg.slice(0, 200)}`);
    });

    child.on('error', (err) => {
      this.log(`  [${project.name}] erro: ${err.message}`);
    });
  }

  private async runHealthChecks(baseUrl: string): Promise<EndpointCheck[]> {
    const endpoints = [
      `${baseUrl}/health`,
      `${baseUrl}/api/health`,
      `${baseUrl}/`,
    ];

    const results: EndpointCheck[] = [];

    for (const url of endpoints) {
      try {
        const startTime = Date.now();
        const response = await fetch(url, {
          signal: AbortSignal.timeout(5000),
        });

        results.push({
          url,
          status: response.status,
          responseTime: Date.now() - startTime,
          healthy: response.status >= 200 && response.status < 400,
        });

        this.log(`  ${response.status >= 200 && response.status < 400 ? '✅' : '❌'} ${url} → ${response.status} (${Date.now() - startTime}ms)`);
      } catch (error) {
        results.push({
          url,
          status: 0,
          responseTime: 0,
          healthy: false,
        });
        this.log(`  ⚠️ ${url} → Não acessível`);
      }
    }

    return results;
  }

  private async stopAll(): Promise<void> {
    for (const proc of this.processes) {
      try {
        if (proc.pid) {
          process.kill(-proc.pid, 'SIGTERM');
        }
      } catch {
        // Processo já finalizado
      }
    }
    this.processes = [];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
