# MCP Azure DevOps Automation - sda-iatec

> Servidor MCP (Model Context Protocol) para automação completa de Features do Azure DevOps com agentes autônomos inteligentes.

## 🎯 Visão Geral

Este projeto implementa um **MCP Server** que se conecta ao Azure DevOps da **sda-iatec**, permitindo automação end-to-end do fluxo de desenvolvimento:

1. **Digitar o número da Feature** → busca automática no Azure DevOps
2. **Análise refinada** → mapeia codebase, identifica impactos, gera plano
3. **Solicitar aprovação** → humano valida a análise antes de prosseguir
4. **Executar Tasks** → implementação automatizada baseada nas tasks
5. **Build** → compilação de todos os projetos
6. **Testes** → unitários, integração e end-to-end
7. **Validação local** → execução e health checks
8. **Pull Request** → criação automática após aprovação

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Client                               │
│              (Kiro / Claude Desktop / Cursor)                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ JSON-RPC (stdio)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server                                 │
│              (mcp-azure-devops-automation)                    │
├─────────────────────────────────────────────────────────────┤
│  Tools:                                                      │
│  • buscar_feature      • executar_pipeline                   │
│  • analisar_feature    • status_pipeline                     │
│  • executar_build      • aprovar_etapa                       │
│  • executar_testes     • executar_local                      │
│  • listar_aprovacoes                                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Azure DevOps │  │  Workflow     │  │   Agentes    │
│   Service     │  │  Pipeline     │  │  Autônomos   │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Agentes Autônomos

| Agente | Responsabilidade |
|--------|-----------------|
| 🔍 **AnalysisAgent** | Busca feature, analisa codebase, identifica impactos |
| ⚡ **TaskExecutorAgent** | Implementa mudanças baseado nas tasks |
| 🔨 **BuildAgent** | Compila projetos (.NET, Node.js) |
| 🧪 **TestAgent** | Executa testes unitários, integração e E2E |
| 🚀 **RunnerAgent** | Inicia projetos localmente, faz health checks |
| 🔀 **PullRequestAgent** | Cria branches, commits e Pull Requests |

## 📋 Pré-requisitos

- **Node.js** >= 20.0.0
- **Azure DevOps** PAT (Personal Access Token) com permissões:
  - Work Items: Read & Write
  - Code: Read & Write
  - Pull Requests: Read & Write
- **.NET SDK** (se projetos .NET no workspace)
- **Git** configurado localmente

## 🚀 Instalação

```bash
# Clonar o repositório
git clone https://github.com/sda-iatec/mcp-azure-devops-automation.git
cd mcp-azure-devops-automation

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais

# Build
npm run build
```

## ⚙️ Configuração

### Variáveis de Ambiente (.env)

```env
# Azure DevOps
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/sda-iatec
AZURE_DEVOPS_PAT=seu-personal-access-token
AZURE_DEVOPS_PROJECT=nome-do-projeto

# Git
GIT_USER_NAME=seu-nome
GIT_USER_EMAIL=seu-email@sda-iatec.com

# Workspace
WORKSPACE_ROOT=/caminho/para/workspace
SOLUTION_PATH=/caminho/para/solution.sln

# Testes
TEST_TIMEOUT_MS=120000
E2E_BASE_URL=http://localhost:5000

# Build
DOTNET_SDK_VERSION=8.0
BUILD_CONFIGURATION=Debug
```

### Integração com MCP Clients

#### Kiro (`.kiro/settings.json`)

```json
{
  "mcpServers": {
    "azure-devops-automation": {
      "command": "node",
      "args": ["/caminho/para/mcp-azure-devops-automation/dist/index.js"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/sda-iatec",
        "AZURE_DEVOPS_PAT": "seu-pat",
        "AZURE_DEVOPS_PROJECT": "seu-projeto",
        "WORKSPACE_ROOT": "/caminho/workspace"
      }
    }
  }
}
```

#### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "azure-devops-automation": {
      "command": "node",
      "args": ["/caminho/para/mcp-azure-devops-automation/dist/index.js"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/sda-iatec",
        "AZURE_DEVOPS_PAT": "seu-pat",
        "AZURE_DEVOPS_PROJECT": "seu-projeto",
        "WORKSPACE_ROOT": "/caminho/workspace"
      }
    }
  }
}
```

## 🛠️ Ferramentas Disponíveis (MCP Tools)

### `buscar_feature`
Busca uma Feature pelo ID no Azure DevOps com todas as informações associadas.

**Parâmetros:**
- `featureId` (number) — ID da Feature no Azure DevOps

**Exemplo de uso:**
```
"Busque a feature 12345"
```

---

### `analisar_feature`
Executa análise refinada: mapeia codebase, identifica áreas impactadas e gera plano de implementação.

**Parâmetros:**
- `featureId` (number) — ID da Feature

**Retorna:**
- Resumo da feature com tasks e test cases
- Projetos identificados no workspace
- Áreas impactadas
- Complexidade estimada
- Riscos e mitigações
- Plano de implementação

---

### `executar_pipeline`
Inicia o pipeline completo de automação (análise → tasks → build → testes → PR).

**Parâmetros:**
- `featureId` (number) — ID da Feature

---

### `status_pipeline`
Verifica o progresso de um pipeline em execução.

**Parâmetros:**
- `pipelineId` (string) — ID do pipeline

---

### `aprovar_etapa`
Aprova ou rejeita uma etapa pendente de aprovação.

**Parâmetros:**
- `approvalId` (string) — ID da aprovação
- `approved` (boolean) — true/false

---

### `executar_build`
Executa build de todos os projetos.

**Parâmetros:**
- `configuration` (string, opcional) — Debug/Release

---

### `executar_testes`
Executa testes do projeto.

**Parâmetros:**
- `testType` (enum) — `unit` | `integration` | `e2e` | `all`

---

### `executar_local`
Inicia projetos e valida com health checks.

**Parâmetros:**
- `healthCheckUrl` (string, opcional) — URL para validação

---

### `listar_aprovacoes`
Lista aprovações pendentes em todos os pipelines.

## 📊 Fluxo de Execução

```
┌─────────┐    ┌──────────┐    ┌─────────────┐    ┌───────────┐
│  BUSCAR  │───▶│ ANALISAR │───▶│   APROVAR   │───▶│  EXECUTAR │
│ FEATURE  │    │ CODEBASE │    │  (humano)   │    │   TASKS   │
└─────────┘    └──────────┘    └─────────────┘    └─────┬─────┘
                                                        │
       ┌────────────────────────────────────────────────┘
       ▼
┌─────────┐    ┌──────────┐    ┌─────────────┐    ┌───────────┐
│  BUILD  │───▶│  TESTES  │───▶│  EXECUÇÃO   │───▶│  APROVAR  │
│         │    │ U+I+E2E  │    │   LOCAL     │    │  (humano) │
└─────────┘    └──────────┘    └─────────────┘    └─────┬─────┘
                                                        │
                                                        ▼
                                                  ┌───────────┐
                                                  │  CRIAR PR │
                                                  └───────────┘
```

### Pontos de Aprovação

O pipeline tem **2 pontos de aprovação humana**:

1. **Após análise** — O usuário revisa o plano de implementação antes de executar
2. **Antes do PR** — O usuário valida os resultados dos testes locais antes de criar o PR

## 🧪 Tipos de Testes Executados

| Tipo | Descrição | Framework Suportado |
|------|-----------|-------------------|
| **Unitários** | Testa componentes isolados | xUnit, NUnit, Jest, Vitest |
| **Integração** | Testa interação entre componentes | xUnit + TestServer, Supertest |
| **End-to-End** | Testa fluxos completos do usuário | Playwright, Cypress, Selenium |

## 🏢 Estrutura do Projeto

```
src/
├── index.ts                    # Entry point do MCP Server
├── config/
│   └── index.ts                # Configuração centralizada
├── types/
│   └── index.ts                # Tipos e interfaces TypeScript
├── services/
│   └── azure-devops.service.ts # Integração com Azure DevOps API
├── agents/
│   ├── base.agent.ts           # Classe base (retry, timeout, logs)
│   ├── analysis.agent.ts       # Agente de análise refinada
│   ├── task-executor.agent.ts  # Agente executor de tasks
│   ├── build.agent.ts          # Agente de build
│   ├── test.agent.ts           # Agente de testes
│   ├── runner.agent.ts         # Agente de execução local
│   ├── pull-request.agent.ts   # Agente de Pull Request
│   └── index.ts                # Exportações
├── tools/
│   └── index.ts                # Ferramentas MCP registradas
└── workflow/
    └── pipeline.ts             # Orquestrador do pipeline
```

## 🔒 Segurança

- **PAT Token**: Nunca commitar o `.env` — use variáveis de ambiente
- **Permissões mínimas**: Configure o PAT apenas com as permissões necessárias
- **Aprovações**: Pipeline pausa para aprovação humana em pontos críticos
- **Draft PR**: PRs são criados como draft por padrão

## 📝 Licença

MIT — sda-iatec
