# Exemplos de Configuração MCP

## Kiro — Configuração no Workspace

Crie o arquivo `.kiro/settings.json` na raiz do seu projeto:

```json
{
  "mcpServers": {
    "azure-devops-automation": {
      "command": "node",
      "args": ["/caminho/absoluto/mcp-azure-devops-automation/dist/index.js"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/sda-iatec",
        "AZURE_DEVOPS_PAT": "seu-pat-aqui",
        "AZURE_DEVOPS_PROJECT": "NomeDoProjeto",
        "WORKSPACE_ROOT": "/home/usuario/projetos/meu-projeto",
        "SOLUTION_PATH": "/home/usuario/projetos/meu-projeto/MeuProjeto.sln",
        "GIT_USER_NAME": "Nome Completo",
        "GIT_USER_EMAIL": "email@sda-iatec.com",
        "BUILD_CONFIGURATION": "Debug",
        "TEST_TIMEOUT_MS": "120000",
        "E2E_BASE_URL": "http://localhost:5000"
      }
    }
  }
}
```

## Claude Desktop — macOS

Edite `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "azure-devops-automation": {
      "command": "node",
      "args": ["/Users/usuario/tools/mcp-azure-devops-automation/dist/index.js"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/sda-iatec",
        "AZURE_DEVOPS_PAT": "seu-pat-aqui",
        "AZURE_DEVOPS_PROJECT": "NomeDoProjeto",
        "WORKSPACE_ROOT": "/Users/usuario/projetos/meu-projeto"
      }
    }
  }
}
```

## Claude Desktop — Windows

Edite `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "azure-devops-automation": {
      "command": "node",
      "args": ["C:\\tools\\mcp-azure-devops-automation\\dist\\index.js"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/sda-iatec",
        "AZURE_DEVOPS_PAT": "seu-pat-aqui",
        "AZURE_DEVOPS_PROJECT": "NomeDoProjeto",
        "WORKSPACE_ROOT": "C:\\projetos\\meu-projeto"
      }
    }
  }
}
```

## Cursor — Configuração

Edite `.cursor/mcp.json` no seu projeto:

```json
{
  "mcpServers": {
    "azure-devops-automation": {
      "command": "node",
      "args": ["./node_modules/@sda-iatec/mcp-azure-devops-automation/dist/index.js"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/sda-iatec",
        "AZURE_DEVOPS_PAT": "seu-pat-aqui",
        "AZURE_DEVOPS_PROJECT": "NomeDoProjeto",
        "WORKSPACE_ROOT": "."
      }
    }
  }
}
```

## Usando com npx (sem instalação local)

Se publicado no npm:

```json
{
  "mcpServers": {
    "azure-devops-automation": {
      "command": "npx",
      "args": ["@sda-iatec/mcp-azure-devops-automation"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/sda-iatec",
        "AZURE_DEVOPS_PAT": "seu-pat-aqui",
        "AZURE_DEVOPS_PROJECT": "NomeDoProjeto",
        "WORKSPACE_ROOT": "/caminho/workspace"
      }
    }
  }
}
```

## Variáveis de Ambiente — Referência Completa

| Variável | Obrigatória | Default | Descrição |
|----------|-------------|---------|-----------|
| `AZURE_DEVOPS_ORG_URL` | ✅ | — | URL da organização Azure DevOps |
| `AZURE_DEVOPS_PAT` | ✅ | — | Personal Access Token |
| `AZURE_DEVOPS_PROJECT` | ✅ | — | Nome do projeto |
| `WORKSPACE_ROOT` | ✅ | — | Raiz do workspace/código |
| `SOLUTION_PATH` | ❌ | `""` | Caminho para .sln |
| `GIT_USER_NAME` | ❌ | `"automation"` | Nome para commits |
| `GIT_USER_EMAIL` | ❌ | `"automation@sda-iatec.com"` | Email para commits |
| `TEST_TIMEOUT_MS` | ❌ | `120000` | Timeout dos testes (ms) |
| `E2E_BASE_URL` | ❌ | `"http://localhost:5000"` | URL base para E2E |
| `DOTNET_SDK_VERSION` | ❌ | `"8.0"` | Versão do .NET SDK |
| `BUILD_CONFIGURATION` | ❌ | `"Debug"` | Config de build |
