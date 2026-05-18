declare module 'hnswlib-node' {
  export class HierarchicalNSW {
    constructor(space: 'l2' | 'ip' | 'cosine', dim: number);
    initIndex(maxElements: number, m?: number, efConstruction?: number, randomSeed?: number): void;
    readIndex(path: string): Promise<void>;
    readIndexSync(path: string): void;
    writeIndex(path: string): Promise<void>;
    writeIndexSync(path: string): void;
    resizeIndex(newSize: number): void;
    addPoint(point: number[], label: number): void;
    markDelete(label: number): void;
    unmarkDelete(label: number): void;
    searchKnn(point: number[], k: number): { neighbors: number[]; distances: number[] };
    getIdsList(): number[];
    getPoint(label: number): number[];
    getMaxElements(): number;
    getCurrentCount(): number;
    getNumDimensions(): number;
    getEf(): number;
    setEf(ef: number): void;
  }
}
