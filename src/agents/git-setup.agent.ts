/**
 * Agente de Preparação Git (Git Setup)
 *
 * Responsabilidades:
 * - Executar git fetch para obter últimas referências remotas
 * - Executar git pull da branch master/main para garantir código atualizado
 * - Criar nova branch com o número da feature: feature/{featureId}
 *
 * TRIGGER: Primeiro passo do pipeline, executado ANTES da análise
 */
import { BaseAgent } from './base.agent.js';
import { AppConfig } from '../config/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface GitSetupInput {
  featureId: number;
  featureTitle?: string;
  workspaceRoot: string;
  baseBranch?: string;
}

interface GitSetupResult {
  baseBranch: string;
  featureBranch: string;
  lastCommit: string;
  fetchSuccess: boolean;
  pullSuccess: boolean;
  branchCreated: boolean;
}

export class GitSetupAgent extends BaseAgent {
  private appConfig: AppConfig;

  constructor(appConfig: AppConfig) {
    super({
      type: 'git-setup',
      name: 'Agente de Preparação Git',
      description: 'Executa git fetch/pull da master e cria branch da feature',
      timeout: 60000, // 1 minuto
      retryCount: 2,
    });
    this.appConfig = appConfig;
  }

  protected async run(input: unknown): Promise<{ message: string; data?: unknown }> {
    const {
      featureId,
      featureTitle,
      workspaceRoot,
      baseBranch = 'master',
    } = input as GitSetupInput;

    const featureBranch = `feature/${featureId}`;

    this.log(`🔄 Preparando repositório para Feature #${featureId}`);
    this.log(`📂 Workspace: ${workspaceRoot}`);
    this.log(`🌿 Branch base: ${baseBranch}`);
    this.log(`🌿 Branch feature: ${featureBranch}`);

    // 1. Configurar git (nome e email)
    this.log('⚙️ Configurando git user...');
    await this.configureGit(workspaceRoot);

    // 2. Git fetch — buscar últimas referências remotas
    this.log('📡 Executando git fetch --all --prune...');
    const fetchSuccess = await this.gitFetch(workspaceRoot);

    // 3. Checkout na branch base (master/main)
    this.log(`🔀 Fazendo checkout em ${baseBranch}...`);
    await this.checkoutBase(workspaceRoot, baseBranch);

    // 4. Git pull — garantir código atualizado
    this.log(`⬇️ Executando git pull origin ${baseBranch}...`);
    const pullSuccess = await this.gitPull(workspaceRoot, baseBranch);

    // 5. Obter último commit para log
    const lastCommit = await this.getLastCommit(workspaceRoot);
    this.log(`📌 Último commit: ${lastCommit}`);

    // 6. Criar nova branch da feature
    this.log(`🌿 Criando branch: ${featureBranch}...`);
    const branchCreated = await this.createFeatureBranch(workspaceRoot, featureBranch);

    if (branchCreated) {
      this.log(`✅ Branch ${featureBranch} criada a partir de ${baseBranch}`);
    } else {
      this.log(`ℹ️ Branch ${featureBranch} já existia, fazendo checkout`);
    }

    const result: GitSetupResult = {
      baseBranch,
      featureBranch,
      lastCommit,
      fetchSuccess,
      pullSuccess,
      branchCreated,
    };

    return {
      message: `Repositório preparado: branch ${featureBranch} criada a partir de ${baseBranch} (${lastCommit})`,
      data: result,
    };
  }

  /**
   * Configura nome e email do git
   */
  private async configureGit(workspaceRoot: string): Promise<void> {
    try {
      await execAsync(
        `git config user.name "${this.appConfig.git.userName}" && ` +
        `git config user.email "${this.appConfig.git.userEmail}"`,
        { cwd: workspaceRoot, timeout: 5000 }
      );
    } catch (error) {
      this.log(`⚠️ Aviso ao configurar git: ${error}`);
    }
  }

  /**
   * Executa git fetch --all --prune
   */
  private async gitFetch(workspaceRoot: string): Promise<boolean> {
    try {
      const { stdout, stderr } = await execAsync('git fetch --all --prune', {
        cwd: workspaceRoot,
        timeout: 30000,
      });

      if (stdout.trim()) this.log(`  fetch stdout: ${stdout.trim()}`);
      if (stderr.trim()) this.log(`  fetch info: ${stderr.trim()}`);

      return true;
    } catch (error: unknown) {
      const err = error as { message?: string };
      this.log(`❌ Falha no git fetch: ${err.message}`);
      throw new Error(`Git fetch falhou: ${err.message}`);
    }
  }

  /**
   * Faz checkout na branch base (master ou main)
   */
  private async checkoutBase(workspaceRoot: string, baseBranch: string): Promise<void> {
    try {
      await execAsync(`git checkout ${baseBranch}`, {
        cwd: workspaceRoot,
        timeout: 10000,
      });
    } catch {
      // Tentar com 'main' se 'master' falhar
      if (baseBranch === 'master') {
        this.log('  → Branch "master" não encontrada, tentando "main"...');
        try {
          await execAsync('git checkout main', {
            cwd: workspaceRoot,
            timeout: 10000,
          });
          this.log('  → Usando branch "main" como base');
        } catch {
          throw new Error('Não foi possível fazer checkout em master ou main');
        }
      } else {
        throw new Error(`Branch base "${baseBranch}" não encontrada`);
      }
    }
  }

  /**
   * Executa git pull origin {baseBranch}
   */
  private async gitPull(workspaceRoot: string, baseBranch: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`git pull origin ${baseBranch}`, {
        cwd: workspaceRoot,
        timeout: 30000,
      });

      if (stdout.includes('Already up to date')) {
        this.log('  → Repositório já está atualizado');
      } else {
        this.log(`  → Pull concluído: ${stdout.trim().split('\n').pop()}`);
      }

      return true;
    } catch (error: unknown) {
      const err = error as { message?: string; stderr?: string };
      // Tentar com 'main' se falhar com baseBranch
      if (baseBranch === 'master') {
        this.log('  → Pull de "master" falhou, tentando "main"...');
        try {
          await execAsync('git pull origin main', {
            cwd: workspaceRoot,
            timeout: 30000,
          });
          return true;
        } catch {
          this.log(`❌ Pull falhou tanto para master quanto main: ${err.message}`);
          throw new Error(`Git pull falhou: ${err.message}`);
        }
      }
      throw new Error(`Git pull falhou: ${err.message}`);
    }
  }

  /**
   * Obtém o hash do último commit (para log/referência)
   */
  private async getLastCommit(workspaceRoot: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git log --oneline -1', {
        cwd: workspaceRoot,
        timeout: 5000,
      });
      return stdout.trim();
    } catch {
      return 'N/A';
    }
  }

  /**
   * Cria a branch feature/{featureId} a partir da branch atual
   */
  private async createFeatureBranch(
    workspaceRoot: string,
    featureBranch: string
  ): Promise<boolean> {
    try {
      // Verificar se branch já existe localmente
      const { stdout: branches } = await execAsync('git branch --list', {
        cwd: workspaceRoot,
        timeout: 5000,
      });

      if (branches.includes(featureBranch)) {
        // Branch já existe — checkout e merge com base atualizada
        this.log(`  → Branch ${featureBranch} já existe, fazendo checkout e atualizando...`);
        await execAsync(`git checkout ${featureBranch}`, {
          cwd: workspaceRoot,
          timeout: 5000,
        });

        // Merge da base para garantir que a feature branch está atualizada
        try {
          await execAsync('git merge --no-edit -', {
            cwd: workspaceRoot,
            timeout: 10000,
          });
        } catch {
          // Se merge falhar (ex: conflito), apenas logar
          this.log('  ⚠️ Merge automático da base não possível (pode haver conflitos)');
        }

        return false; // Não foi criada, já existia
      }

      // Criar nova branch
      await execAsync(`git checkout -b ${featureBranch}`, {
        cwd: workspaceRoot,
        timeout: 5000,
      });

      return true; // Branch nova criada
    } catch (error: unknown) {
      const err = error as { message?: string };
      // Fallback: tentar criar mesmo assim
      try {
        await execAsync(`git checkout -b ${featureBranch}`, {
          cwd: workspaceRoot,
          timeout: 5000,
        });
        return true;
      } catch {
        throw new Error(`Falha ao criar branch ${featureBranch}: ${err.message}`);
      }
    }
  }
}
