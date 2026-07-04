/**
 * Serviço de integração com Azure DevOps REST API
 * Responsável por buscar Features, Tasks, Test Cases e gerenciar Work Items
 */
import * as azdev from 'azure-devops-node-api';
import * as witApi from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js';
import { AzureDevOpsConfig, WorkItem, WorkItemRelation, WorkItemType } from '../types/index.js';

export class AzureDevOpsService {
  private connection: azdev.WebApi;
  private project: string;

  constructor(config: AzureDevOpsConfig) {
    const authHandler = azdev.getPersonalAccessTokenHandler(config.pat);
    this.connection = new azdev.WebApi(config.orgUrl, authHandler);
    this.project = config.project;
  }

  /**
   * Busca uma Feature pelo ID com todas as relações (tasks, test cases)
   */
  async getFeature(featureId: number): Promise<WorkItem> {
    const witClient = await this.connection.getWorkItemTrackingApi();
    
    const workItem = await witClient.getWorkItem(
      featureId,
      undefined,
      undefined,
      witApi.WorkItemExpand.All
    );

    if (!workItem || !workItem.fields) {
      throw new Error(`Feature #${featureId} não encontrada no Azure DevOps`);
    }

    const type = workItem.fields['System.WorkItemType'] as string;
    if (type !== 'Feature') {
      throw new Error(`Work Item #${featureId} não é uma Feature (tipo: ${type})`);
    }

    return this.mapWorkItem(workItem);
  }

  /**
   * Busca todos os Work Items filhos de uma Feature
   */
  async getFeatureChildren(featureId: number): Promise<WorkItem[]> {
    const witClient = await this.connection.getWorkItemTrackingApi();
    
    // Buscar a feature com relações
    const feature = await witClient.getWorkItem(
      featureId,
      undefined,
      undefined,
      witApi.WorkItemExpand.Relations
    );

    if (!feature?.relations) {
      return [];
    }

    // Filtrar apenas relações de filho (child)
    const childRelations = feature.relations.filter(
      (r) => r.rel === 'System.LinkTypes.Hierarchy-Forward'
    );

    if (childRelations.length === 0) {
      return [];
    }

    // Extrair IDs dos filhos
    const childIds = childRelations
      .map((r) => this.extractIdFromUrl(r.url || ''))
      .filter((id): id is number => id !== null);

    // Buscar detalhes de cada filho
    const children = await witClient.getWorkItems(
      childIds,
      undefined,
      undefined,
      witApi.WorkItemExpand.All
    );

    return children
      .filter((wi): wi is witApi.WorkItem => wi !== null && wi !== undefined)
      .map((wi) => this.mapWorkItem(wi));
  }

  /**
   * Busca Tasks associadas a uma Feature
   */
  async getFeatureTasks(featureId: number): Promise<WorkItem[]> {
    const children = await this.getFeatureChildren(featureId);
    return children.filter((wi) => wi.type === 'Task');
  }

  /**
   * Busca Test Cases associados a uma Feature
   */
  async getFeatureTestCases(featureId: number): Promise<WorkItem[]> {
    const children = await this.getFeatureChildren(featureId);
    return children.filter((wi) => wi.type === 'Test Case');
  }

  /**
   * Busca tasks de teste (tasks com tag "teste" ou tipo específico)
   */
  async getFeatureTestTasks(featureId: number): Promise<WorkItem[]> {
    const children = await this.getFeatureChildren(featureId);
    return children.filter(
      (wi) =>
        wi.type === 'Task' &&
        (wi.tags?.some((t) => t.toLowerCase().includes('test')) ||
          wi.title.toLowerCase().includes('teste') ||
          wi.title.toLowerCase().includes('test'))
    );
  }

  /**
   * Atualiza o estado de um Work Item
   */
  async updateWorkItemState(workItemId: number, state: string): Promise<void> {
    const witClient = await this.connection.getWorkItemTrackingApi();
    
    const patchDocument: witApi.JsonPatchOperation[] = [
      {
        op: witApi.Operation.Replace,
        path: '/fields/System.State',
        value: state,
      },
    ];

    await witClient.updateWorkItem(undefined, patchDocument, workItemId, this.project);
  }

  /**
   * Adiciona um comentário a um Work Item
   */
  async addComment(workItemId: number, comment: string): Promise<void> {
    const witClient = await this.connection.getWorkItemTrackingApi();
    
    const patchDocument: witApi.JsonPatchOperation[] = [
      {
        op: witApi.Operation.Add,
        path: '/fields/System.History',
        value: comment,
      },
    ];

    await witClient.updateWorkItem(undefined, patchDocument, workItemId, this.project);
  }

  /**
   * Busca Work Items por query WIQL
   */
  async queryWorkItems(wiql: string): Promise<WorkItem[]> {
    const witClient = await this.connection.getWorkItemTrackingApi();
    
    const queryResult = await witClient.queryByWiql(
      { query: wiql },
      { project: this.project }
    );

    if (!queryResult.workItems || queryResult.workItems.length === 0) {
      return [];
    }

    const ids = queryResult.workItems
      .map((wi) => wi.id)
      .filter((id): id is number => id !== undefined);

    const workItems = await witClient.getWorkItems(
      ids,
      undefined,
      undefined,
      witApi.WorkItemExpand.All
    );

    return workItems
      .filter((wi): wi is witApi.WorkItem => wi !== null && wi !== undefined)
      .map((wi) => this.mapWorkItem(wi));
  }

  // ============================================================
  // Helpers privados
  // ============================================================

  private mapWorkItem(wi: witApi.WorkItem): WorkItem {
    const fields = wi.fields || {};
    const tags = fields['System.Tags'] as string | undefined;

    return {
      id: wi.id || 0,
      title: (fields['System.Title'] as string) || '',
      type: (fields['System.WorkItemType'] as WorkItemType) || 'Task',
      state: (fields['System.State'] as string) || '',
      description: (fields['System.Description'] as string) || '',
      acceptanceCriteria: fields['Microsoft.VSTS.Common.AcceptanceCriteria'] as string | undefined,
      assignedTo: (fields['System.AssignedTo'] as { displayName?: string })?.displayName,
      areaPath: fields['System.AreaPath'] as string | undefined,
      iterationPath: fields['System.IterationPath'] as string | undefined,
      tags: tags ? tags.split(';').map((t) => t.trim()) : [],
      relations: this.mapRelations(wi.relations),
      fields,
    };
  }

  private mapRelations(relations?: witApi.WorkItemRelation[]): WorkItemRelation[] {
    if (!relations) return [];

    return relations
      .filter((r) => r.url && r.rel)
      .map((r) => {
        const id = this.extractIdFromUrl(r.url || '');
        let type: WorkItemRelation['type'] = 'related';

        if (r.rel === 'System.LinkTypes.Hierarchy-Forward') type = 'child';
        else if (r.rel === 'System.LinkTypes.Hierarchy-Reverse') type = 'parent';
        else if (r.rel === 'Microsoft.VSTS.Common.TestedBy-Forward') type = 'tested-by';
        else if (r.rel === 'Microsoft.VSTS.Common.TestedBy-Reverse') type = 'tests';

        return {
          type,
          workItemId: id || 0,
          title: (r.attributes?.['name'] as string) || undefined,
        };
      });
  }

  private extractIdFromUrl(url: string): number | null {
    const match = url.match(/\/workItems\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }
}
