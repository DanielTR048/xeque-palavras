# Contrato de progresso sincronizado — versão 1

O documento pertence a **um perfil** (`daniel` ou `larissa`) dentro da conta autenticada. O servidor determina a conta pela identidade do Sites ou pelo vínculo do aparelho. Conta, perfil e credenciais não fazem parte do documento. Nunca mesclar documentos de perfis diferentes.

```ts
type SyncDocument = {
  version: 1;
  games: Record<string, SyncGame>;
  results: Record<string, SyncResult>;
  config: { value: GameConfig; updatedAt: number } | null;
  preferences: {
    value: { highContrast: boolean; sound: boolean };
    updatedAt: number;
  } | null;
  legacy: Record<string, { pt: Accumulator; en: Accumulator; all: Accumulator }>;
  conflicts?: Record<string, SyncGame[]>;
};
type SyncGame = { game: GameState; day: string; updatedAt: number };
type SyncResult = {
  id: string;
  language: 'pt' | 'en';
  won: boolean;
  finishedAt: number;
  attempts: number;
};
type Accumulator = {
  played: number; won: number; currentStreak: number; bestStreak: number;
  distribution: Record<number, number>;
};
type GameConfig = {
  language: 'pt' | 'en';
  mode: 'classic' | 'daily' | 'duo' | 'quartet' | 'blitz';
  difficulty: 'easy' | 'normal' | 'hard';
  length: number; // 4–8
};
type GameState = {
  id: string; config: GameConfig; targets: string[]; guesses: string[];
  status: 'playing' | 'won' | 'lost';
  startedAt: number | null; finishedAt: number | null;
  maxAttempts: number; durationSeconds: number | null;
};
```

Tempos são inteiros em milissegundos Unix; `day` é uma data local válida `YYYY-MM-DD`. Letras são ASCII minúsculas, já normalizadas sem acentos. Tentativas máximas: fácil 8, normal 6, difícil 5, mais 2 no Dueto ou 4 no Quarteto. Blitz dura 120 segundos. Os identificadores têm até 300 caracteres e não admitem caracteres de controle nem chaves de protótipo JavaScript.

## Identidade e mesclagem

O identificador diário é `daily:${day}:${language}:${difficulty}:${length}`, igual no Android e na web. Identificadores de outros modos permanecem inalterados. As chaves de `games` e `results` correspondem ao `id` interno. O parser aceita identificadores diários antigos presentes em partidas completas, normaliza suas chaves e remapeia os respectivos resultados.

Uma mesclagem é uma união idempotente e determinística. Para a mesma partida, a prioridade é vitória, outro encerramento, maior quantidade de tentativas, maior `updatedAt` e desempate estável pelo conteúdo. Assim, um rascunho vazio ou atrasado não substitui uma partida concluída. Sequências de tentativas compatíveis preservam o progresso mais completo. Sequências divergentes, alvos diferentes ou outra configuração ficam guardados em `conflicts[id]`, além da versão escolhida em `games[id]`. Essas cópias não contam duas vezes nas estatísticas.

Resultados são deduplicados por `id`. Partidas completas encerradas são a fonte prioritária de seus resultados, mesmo se um cliente mandar um resumo contraditório. Resumos sem partida completa permitem importar estatísticas antigas do Android. `attempts: 0` significa número de tentativas desconhecido na migração; uma derrota de Blitz antes de uma tentativa também pode ter zero. Vitórias antigas com número desconhecido aparecem na distribuição `0`, separadas das faixas conhecidas.

Configuração e preferências usam `updatedAt`, com desempate estável. Partidas de modos livres diferentes continuam no histórico; `latestGame` seleciona a mais recentemente salva para a configuração. No diário, também exige a data pedida.

## Migração sem contagem duplicada

Cada navegador e aplicativo conserva um identificador aleatório estável para sua importação. `legacy[origem]` guarda somente totais anteriores ao histórico recuperável (`beforeHistory` na web), nunca um total que já inclua os resultados enviados em `results`. O mesmo identificador de origem não é somado duas vezes. Totais legados devem ser imutáveis após a migração; se cópias antigas divergirem, prevalece deterministicamente a de maior total de partidas, depois vitórias e conteúdo.

Os resultados antigos do Android têm identificadores e podem ser migrados individualmente. Sem a partida completa, seus identificadores diários antigos não contêm dificuldade/tamanho suficientes para reconstruir o identificador canônico; preservar o identificador original é preferível a inventar informação. Quando a partida completa ainda existe, remapear seu resultado para o identificador canônico.

As estatísticas somam os totais legados uma vez e processam os resultados individuais por conclusão. Com várias origens que só possuem totais agregados, não há cronologia para inventar uma sequência contínua: a sequência atual parte de zero antes dos resultados conhecidos, e a melhor sequência preserva pelo menos o maior valor informado pelas origens.

## Validação e limites

`parseDocument(unknown)` rejeita campos desconhecidos, estruturas incompletas, datas inválidas, estados de partida impossíveis e chaves inválidas. Não remove silenciosamente registros inválidos. O JSON UTF-8 inteiro e o resultado de cada mesclagem devem ter até 2 MiB; limites adicionais são 5.000 partidas, 5.000 resultados, 5.000 cópias de conflito e 64 origens legadas por perfil. Exceder esses limites gera erro e deve manter o progresso local intacto para recuperação.

O cliente nunca deve tratar falha HTTP, expiração de acesso, indisponibilidade da rede ou conflito de revisão como autorização para substituir a cópia local por um documento vazio. O servidor mescla com a revisão atual dentro de uma operação protegida contra atualizações concorrentes. O cliente mantém alterações feitas durante uma sincronização e as mescla com a resposta antes da próxima sincronização.

## Implementação compartilhada

`src/sync/model.ts` exporta `emptyDocument`, `parseDocument`, `mergeDocuments`, `canonicalGameId(game, day)`, `latestGame(document, config, day)`, `documentStats(document, language?)` e `documentHistory(document, language?)`, além dos tipos acima. `latestGame` retorna `SyncGame | null`; o histórico retorna resumos `SyncResult[]` em ordem decrescente de conclusão. `documentStats` acrescenta `winRate` inteiro de 0 a 100 ao acumulador.

Credenciais, pareamento, acesso e revogação são responsabilidades da API e do armazenamento protegido do Android; nunca integrar tokens ao documento de progresso.
