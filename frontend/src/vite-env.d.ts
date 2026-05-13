/// <reference types="vite/client" />

declare module 'y-monaco' {
  import type * as monaco from 'monaco-editor';
  import type { Awareness } from 'y-protocols/awareness';
  import type * as Y from 'yjs';

  export class MonacoBinding {
    constructor(
      ytext: Y.Text,
      monacoModel: monaco.editor.ITextModel,
      editors?: Set<monaco.editor.IStandaloneCodeEditor>,
      awareness?: Awareness
    );
    destroy(): void;
  }
}
