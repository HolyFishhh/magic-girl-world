import {
  ARCHETYPE_GRAPH,
  ARCHETYPE_GRAPH_SPEC,
  createContentMechanicsFingerprint,
  type EncounterLineageMemory,
} from '../game-core';

export const DESIGN_KNOWLEDGE_GRAPH_SPEC = 'mwg.st-knowledge-graph/v1' as const;

export type KnowledgeNodeKind = 'archetype' | 'constraint' | 'enemy-family' | 'enemy-action';
export type KnowledgeEdgeKind = 'evolves-to' | 'anti-synergy' | 'uses-action' | 'related-to';

export interface KnowledgeNode {
  id: string;
  kind: KnowledgeNodeKind;
  label: string;
  data: Record<string, unknown>;
}

export interface KnowledgeEdge {
  id: string;
  from: string;
  to: string;
  kind: KnowledgeEdgeKind;
  weight: number;
  data?: Record<string, unknown>;
}

export interface KnowledgeGraphSnapshot {
  spec: typeof DESIGN_KNOWLEDGE_GRAPH_SPEC;
  contentVersion: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface KnowledgeGraphView {
  spec: typeof DESIGN_KNOWLEDGE_GRAPH_SPEC;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  evolutionPaths: Array<{
    from: string;
    to: string;
    fromLabel: string;
    toLabel: string;
    transitionCost: number;
    bridgeFeatures: string[];
  }>;
}

function stableId(...parts: unknown[]): string {
  return parts
    .map(part => String(part ?? '').trim().toLowerCase().replace(/[^a-z0-9_\-一-鿿]+/gi, '_'))
    .join(':');
}

function baseGraph(): KnowledgeGraphSnapshot {
  const nodes = new Map<string, KnowledgeNode>();
  const edges = new Map<string, KnowledgeEdge>();
  for (const archetype of ARCHETYPE_GRAPH) {
    const nodeId = `archetype:${archetype.id}`;
    nodes.set(nodeId, {
      id: nodeId,
      kind: 'archetype',
      label: archetype.label,
      data: {
        description: archetype.description,
        requiredFeatures: archetype.requiredFeatures,
        optionalFeatures: archetype.optionalFeatures,
        payoffFeatures: archetype.payoffFeatures,
        genericRoles: archetype.genericRoles,
      },
    });
    for (const neighbor of archetype.neighbors) {
      const targetId = `archetype:${neighbor.target}`;
      const id = stableId(nodeId, 'evolves-to', targetId);
      edges.set(id, {
        id,
        from: nodeId,
        to: targetId,
        kind: 'evolves-to',
        weight: Math.max(0.01, 1 - neighbor.transitionCost),
        data: {
          transitionCost: neighbor.transitionCost,
          bridgeFeatures: neighbor.bridgeFeatures,
        },
      });
    }
    for (const constraint of archetype.antiSynergies) {
      const constraintId = `constraint:${stableId(constraint)}`;
      nodes.set(constraintId, {
        id: constraintId,
        kind: 'constraint',
        label: constraint,
        data: {},
      });
      const id = stableId(nodeId, 'anti-synergy', constraintId);
      edges.set(id, {
        id,
        from: nodeId,
        to: constraintId,
        kind: 'anti-synergy',
        weight: 1,
      });
    }
  }
  return {
    spec: DESIGN_KNOWLEDGE_GRAPH_SPEC,
    contentVersion: `${ARCHETYPE_GRAPH_SPEC}:${createContentMechanicsFingerprint(ARCHETYPE_GRAPH)}`,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}

function lineageGraph(lineage: EncounterLineageMemory): Pick<KnowledgeGraphSnapshot, 'nodes' | 'edges'> {
  const nodes = new Map<string, KnowledgeNode>();
  const edges = new Map<string, KnowledgeEdge>();
  for (const family of lineage.families) {
    const familyId = `family:${family.key}`;
    nodes.set(familyId, {
      id: familyId,
      kind: 'enemy-family',
      label: family.label || family.key,
      data: {
        encounters: family.encounters,
        members: family.memberNames,
        stages: family.stages,
        themeAxes: family.themeAxes,
        statusIds: family.statusIds,
      },
    });
    for (const action of family.canonicalActions) {
      const actionId = `enemy-action:${family.key}:${stableId(action.id, action.structuralFingerprint)}`;
      nodes.set(actionId, {
        id: actionId,
        kind: 'enemy-action',
        label: action.name,
        data: {
          structuralFingerprint: action.structuralFingerprint,
          definition: action.definition,
        },
      });
      const id = stableId(familyId, 'uses-action', actionId);
      edges.set(id, { id, from: familyId, to: actionId, kind: 'uses-action', weight: 1 });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

class IndexedGraphPersistence {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('magic-girl-world-design-graph-v1', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('snapshots')) {
          request.result.createObjectStore('snapshots');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开流派图谱数据库'));
    });
    return this.databasePromise;
  }

  async save(snapshot: KnowledgeGraphSnapshot): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('snapshots', 'readwrite');
      transaction.objectStore('snapshots').put(snapshot, 'base');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('无法保存流派图谱'));
    });
  }
}

/**
 * Versioned, queryable graph used by the extension. Matching remains structural:
 * narrative names are stored only for enemy-family continuity, never for archetype scoring.
 */
export class DesignKnowledgeGraph {
  private readonly base = baseGraph();
  private readonly persistence = new IndexedGraphPersistence();

  async initialize(): Promise<void> {
    await this.persistence.save(this.base);
  }

  stats(lineage?: EncounterLineageMemory): { nodes: number; edges: number; version: string } {
    const dynamic = lineage ? lineageGraph(lineage) : { nodes: [], edges: [] };
    return {
      nodes: this.base.nodes.length + dynamic.nodes.length,
      edges: this.base.edges.length + dynamic.edges.length,
      version: this.base.contentVersion,
    };
  }

  query(archetypeIds: string[] = [], lineage?: EncounterLineageMemory, depth = 1, limit = 36): KnowledgeGraphView {
    const dynamic = lineage ? lineageGraph(lineage) : { nodes: [], edges: [] };
    const allNodes = [...this.base.nodes, ...dynamic.nodes];
    const allEdges = [...this.base.edges, ...dynamic.edges];
    const byId = new Map(allNodes.map(node => [node.id, node]));
    const requested = archetypeIds
      .map(id => id.startsWith('archetype:') ? id : `archetype:${id}`)
      .filter(id => byId.has(id));
    const seeds = requested.length
      ? requested
      : this.base.nodes.filter(node => node.kind === 'archetype').slice(0, 4).map(node => node.id);
    const visited = new Set(seeds);
    const frontier = [...seeds];
    for (let level = 0; level < Math.max(0, Math.min(3, depth)); level += 1) {
      const round = frontier.splice(0);
      for (const current of round) {
        for (const edge of allEdges) {
          if (edge.from !== current && edge.to !== current) continue;
          const target = edge.from === current ? edge.to : edge.from;
          if (visited.has(target) || visited.size >= limit) continue;
          visited.add(target);
          frontier.push(target);
        }
      }
    }
    for (const node of dynamic.nodes) {
      if (visited.size >= limit) break;
      visited.add(node.id);
    }
    const nodes = [...visited].map(id => byId.get(id)).filter((node): node is KnowledgeNode => Boolean(node));
    const edges = allEdges.filter(edge => visited.has(edge.from) && visited.has(edge.to));
    const evolutionPaths = edges
      .filter(edge => edge.kind === 'evolves-to')
      .slice(0, 12)
      .map(edge => ({
        from: edge.from,
        to: edge.to,
        fromLabel: byId.get(edge.from)?.label || edge.from,
        toLabel: byId.get(edge.to)?.label || edge.to,
        transitionCost: Number(edge.data?.transitionCost ?? Math.max(0, 1 - edge.weight)),
        bridgeFeatures: Array.isArray(edge.data?.bridgeFeatures)
          ? edge.data!.bridgeFeatures.map(String).slice(0, 6)
          : [],
      }));
    return { spec: DESIGN_KNOWLEDGE_GRAPH_SPEC, nodes, edges, evolutionPaths };
  }
}
