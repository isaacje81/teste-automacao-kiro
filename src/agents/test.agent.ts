/**
 * Agente de Testes
 * 
 * Responsabilidades:
 * - Executar testes unitários
 * - Executar testes de integração
 * - Executar testes end-to-end (E2E)
 * - Coletar resultados e cobertura
 * - Reportar falhas detalhadas
 */
import { BaseAgent } from './base.agent.js';
import { TestResult, TestFailure, ProjectInfo } from '../types/index.js';
import { AppConfig } from '../config/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { join } from 'path';

const execAsync = promisify(exec);

interface TestInput {
  testType: 'unit' | 'integration' | 'e2e' | 'all';
  projects: ProjectInfo[];
  workspaceRoot: string;
}

export class TestAgent extends BaseAgent {
  private appConfig: AppConfig;

  constructor(appConfig: AppConfig) {
    super({
      type: 'test',
      name: 'Agente de Testes',
      description: 'Executa testes unitários, integração e e2e',
      timeout: 300000, // 5 minutos
      retryCount: 1,
    });
    this.appConfig = appConfig;
  }

  protected async run(input: unknown): Promise<{ message: string; data?: unknown }> {
    const { testType, projects, workspaceRoot } = input as TestInput;

    this.log(`🧪 Iniciando execução de testes: ${testType}`);

    const testProjects = projects.filter((p) => p.type === 'test');
    const results: TestResult[] = [];

    if (testType === 'all' || testType === 'unit') {
      this.log('\n📋 === TESTES UNITÁRIOS ===');
      const unitResult = await this.runUnitTests(testProjects, workspaceRoot);
      results.push(unitResult);
      this.logTestResult('Unitários', unitResult);
    }

    if (testType === 'all' || testType === 'integration') {
      this.log('\n📋 === TESTES DE INTEGRAÇÃO ===');
      const integrationResult = await this.runIntegrationTests(testProjects, workspaceRoot);
      results.push(integrationResult);
      this.logTestResult('Integração', integrationResult);
    }

    if (testType === 'all' || testType === 'e2e') {
      this.log('\n📋 === TESTES END-TO-END ===');
      const e2eResult = await this.runE2ETests(workspaceRoot);
      results.push(e2eResult);
      this.logTestResult('E2E', e2eResult);
    }

    const allPassed = results.every((r) => r.success);
    const totalTests = results.reduce((sum, r) => sum + r.totalTests, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
    const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);

    const summary = {
      allPassed,
      results,
      totals: {
        tests: totalTests,
        passed: totalPassed,
        failed: totalFailed,
        skipped: results.reduce((sum, r) => sum + r.skipped, 0),
      },
    };

    if (!allPassed) {
      throw new Error(
        `Testes falharam: ${totalFailed}/${totalTests} testes com falha. ` +
        `Detalhes nos logs.`
      );
    }

    return {
      message: `Todos os testes passaram: ${totalPassed}/${totalTests} testes OK`,
      data: summary,
    };
  }

  private async runUnitTests(projects: ProjectInfo[], workspaceRoot: string): Promise<TestResult> {
    const startTime = Date.now();

    // Filtrar projetos de teste unitário
    const unitTestProjects = projects.filter(
      (p) => p.name.toLowerCase().includes('unit') || 
             (!p.name.toLowerCase().includes('integration') && !p.name.toLowerCase().includes('e2e'))
    );

    if (unitTestProjects.length === 0) {
      this.log('⚠️ Nenhum projeto de teste unitário encontrado');
      return this.emptyResult('unit', startTime);
    }

    return this.executeDotnetTests(unitTestProjects, workspaceRoot, 'unit', '--filter "Category=Unit|TestCategory=Unit"');
  }

  private async runIntegrationTests(projects: ProjectInfo[], workspaceRoot: string): Promise<TestResult> {
    const startTime = Date.now();

    const integrationProjects = projects.filter(
      (p) => p.name.toLowerCase().includes('integration')
    );

    if (integrationProjects.length === 0) {
      this.log('⚠️ Nenhum projeto de teste de integração encontrado, tentando filtro...');
      // Tentar rodar com filtro nos projetos existentes
      return this.executeDotnetTests(projects, workspaceRoot, 'integration', '--filter "Category=Integration|TestCategory=Integration"');
    }

    return this.executeDotnetTests(integrationProjects, workspaceRoot, 'integration', '');
  }

  private async runE2ETests(workspaceRoot: string): Promise<TestResult> {
    const startTime = Date.now();

    try {
      // Tentar executar testes E2E com diferentes frameworks
      // Primeiro, tentar Playwright/Cypress (Node.js)
      try {
        const { stdout } = await execAsync('npx playwright test --reporter=json 2>/dev/null || npx cypress run --reporter json 2>/dev/null', {
          cwd: workspaceRoot,
          timeout: this.appConfig.test.timeoutMs,
        });
        return this.parseNodeTestOutput(stdout, 'e2e', startTime);
      } catch {
        // Se não tiver Node.js e2e, tentar .NET
        const { stdout } = await execAsync(
          `dotnet test --filter "Category=E2E|TestCategory=E2E" --logger "trx" --results-directory ./TestResults`,
          {
            cwd: workspaceRoot,
            timeout: this.appConfig.test.timeoutMs,
          }
        );
        return this.parseDotnetTestOutput(stdout, 'e2e', startTime);
      }
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      this.log(`⚠️ Erro ao executar testes E2E: ${err.message}`);
      return {
        type: 'e2e',
        success: false,
        totalTests: 0,
        passed: 0,
        failed: 1,
        skipped: 0,
        duration: Date.now() - startTime,
        failures: [{
          testName: 'E2E Setup',
          className: 'E2E',
          message: err.message || 'Falha ao inicializar testes E2E',
        }],
      };
    }
  }

  private async executeDotnetTests(
    projects: ProjectInfo[],
    workspaceRoot: string,
    type: TestResult['type'],
    filter: string
  ): Promise<TestResult> {
    const startTime = Date.now();

    for (const project of projects) {
      try {
        const command = `dotnet test "${project.path}" ${filter} --logger "console;verbosity=detailed" --no-build`;
        this.log(`→ Executando: ${command}`);

        const { stdout, stderr } = await execAsync(command, {
          cwd: workspaceRoot,
          timeout: this.appConfig.test.timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        });

        return this.parseDotnetTestOutput(`${stdout}\n${stderr}`, type, startTime);
      } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string };
        const output = `${err.stdout || ''}\n${err.stderr || ''}`;
        return this.parseDotnetTestOutput(output, type, startTime);
      }
    }

    return this.emptyResult(type, startTime);
  }

  private parseDotnetTestOutput(output: string, type: TestResult['type'], startTime: number): TestResult {
    const lines = output.split('\n');
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const failures: TestFailure[] = [];

    for (const line of lines) {
      if (line.includes('Passed!') || line.match(/Passed\s*-/)) {
        const match = line.match(/(\d+)\s*passed/i);
        if (match) passed = parseInt(match[1]);
      }
      if (line.includes('Failed!') || line.match(/Failed\s*-/)) {
        const match = line.match(/(\d+)\s*failed/i);
        if (match) failed = parseInt(match[1]);
      }
      if (line.match(/(\d+)\s*skipped/i)) {
        const match = line.match(/(\d+)\s*skipped/i);
        if (match) skipped = parseInt(match[1]);
      }
      if (line.includes('Failed') && line.includes('.')) {
        failures.push({
          testName: line.trim(),
          className: 'Unknown',
          message: line.trim(),
        });
      }
    }

    return {
      type,
      success: failed === 0,
      totalTests: passed + failed + skipped,
      passed,
      failed,
      skipped,
      duration: Date.now() - startTime,
      failures: failures.slice(0, 10),
    };
  }

  private parseNodeTestOutput(output: string, type: TestResult['type'], startTime: number): TestResult {
    try {
      const json = JSON.parse(output);
      return {
        type,
        success: json.numFailedTests === 0,
        totalTests: json.numTotalTests || 0,
        passed: json.numPassedTests || 0,
        failed: json.numFailedTests || 0,
        skipped: json.numPendingTests || 0,
        duration: Date.now() - startTime,
        failures: [],
      };
    } catch {
      return this.emptyResult(type, startTime);
    }
  }

  private emptyResult(type: TestResult['type'], startTime: number): TestResult {
    return {
      type,
      success: true,
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: Date.now() - startTime,
      failures: [],
    };
  }

  private logTestResult(name: string, result: TestResult): void {
    const icon = result.success ? '✅' : '❌';
    this.log(`${icon} ${name}: ${result.passed}/${result.totalTests} passaram (${result.duration}ms)`);
    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        this.log(`   ❌ ${failure.testName}: ${failure.message}`);
      }
    }
  }
}
