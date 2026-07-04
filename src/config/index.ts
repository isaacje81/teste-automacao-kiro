/**
 * Configuração centralizada do MCP Server
 */
import { config } from 'dotenv';
import { AzureDevOpsConfig } from '../types/index.js';

config();

export interface AppConfig {
  azureDevOps: AzureDevOpsConfig;
  workspace: {
    root: string;
    solutionPath: string;
  };
  git: {
    userName: string;
    userEmail: string;
  };
  test: {
    timeoutMs: number;
    e2eBaseUrl: string;
  };
  build: {
    dotnetVersion: string;
    configuration: string;
  };
}

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  }
  return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export function loadConfig(): AppConfig {
  return {
    azureDevOps: {
      orgUrl: getEnvOrThrow('AZURE_DEVOPS_ORG_URL'),
      pat: getEnvOrThrow('AZURE_DEVOPS_PAT'),
      project: getEnvOrThrow('AZURE_DEVOPS_PROJECT'),
    },
    workspace: {
      root: getEnvOrThrow('WORKSPACE_ROOT'),
      solutionPath: getEnvOrDefault('SOLUTION_PATH', ''),
    },
    git: {
      userName: getEnvOrDefault('GIT_USER_NAME', 'automation'),
      userEmail: getEnvOrDefault('GIT_USER_EMAIL', 'automation@sda-iatec.com'),
    },
    test: {
      timeoutMs: parseInt(getEnvOrDefault('TEST_TIMEOUT_MS', '120000')),
      e2eBaseUrl: getEnvOrDefault('E2E_BASE_URL', 'http://localhost:5000'),
    },
    build: {
      dotnetVersion: getEnvOrDefault('DOTNET_SDK_VERSION', '8.0'),
      configuration: getEnvOrDefault('BUILD_CONFIGURATION', 'Debug'),
    },
  };
}
