# Dicionários de palavras

Fontes consultadas e baixadas em 2026-10-03. Os arquivos são distribuídos junto ao jogo: jogar não consulta serviços externos de palavras. Nenhuma palavra foi gerada por combinação aleatória de letras.

| Idioma | Total único | 4 letras | 5 letras | 6 letras | 7 letras | 8 letras | Alvos comuns |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PT | 56.887 | 2.382 | 6.047 | 10.985 | 16.674 | 20.799 | 756 |
| EN | 40.762 | 2.744 | 5.198 | 8.393 | 11.677 | 12.750 | 2405 |

## Critérios

As listas completas validam tentativas de 4 a 8 letras. O léxico português inclui regionalismos e termos especializados. A lista inglesa é a versão americana padrão de tamanho 60 do English Speller Database (ESDB, anteriormente SCOWL), indicada pelo mantenedor para correção ortográfica.

A normalização remove os acentos com Unicode NFD, converte a caixa para minúsculas e admite apenas A–Z. Assim, “ação” vira “acao” e “maçã” vira “maca”; formas que passam a ser iguais contam uma única vez. Entradas com maiúsculas são descartadas antes dessa transformação para reduzir nomes próprios e siglas. Também são descartados hífens, espaços, apóstrofos, números e símbolos. A fonte portuguesa já usa predominantemente minúsculas, portanto esse filtro não garante eliminar todos os nomes próprios.

O conjunto de respostas comuns em `src/data/common-words.ts` foi selecionado manualmente para partidas com vocabulário familiar. Ele não foi copiado de Termo ou Wordle e é menor que o conjunto de tentativas aceitas. Cada resposta comum pertence ao dicionário completo. Os poucos complementos editoriais documentados abaixo são palavras reais, não palavras sintéticas.

## Fontes, atribuição e integridade

### PT

- Fonte: [fserb/pt-br — léxico de português](https://github.com/fserb/pt-br).
- Arquivo: [lexico](https://raw.githubusercontent.com/fserb/pt-br/93ba2a6f3b2f85262fba72df09d448c6bb2fa50a/lexico).
- Revisão fixada: `93ba2a6f3b2f85262fba72df09d448c6bb2fa50a`.
- Licença: MIT; cópia integral em [LICENSE-pt.txt](../public/dictionaries/LICENSE-pt.txt).
- SHA-256 do arquivo original: `1148de44d58d59e40ef0a6695acefc031acf3f3e6bbfbfcc4c18d85660bde7c1`.
- SHA-256 do JSON final: `942ec6988ad7e71bd1be3a14765b2f24d0631843d9840cda5b3fc6900240bbee`.
- Alvos comuns por tamanho: 4 letras: 140; 5 letras: 224; 6 letras: 150; 7 letras: 128; 8 letras: 114.
- Complementos editoriais comuns ausentes da fonte: `campeoes`, `luzes`, `ovos`, `paes`, `tesouras`.

### EN

- Fonte: [English Speller Database / SCOWL — American English, size 60](https://github.com/en-wl/wordlist-diff).
- Arquivo: [en_US.txt](https://raw.githubusercontent.com/en-wl/wordlist-diff/7f2f4078354752045ee16a041605686561122185/en_US.txt).
- Revisão fixada: `7f2f4078354752045ee16a041605686561122185`.
- Licença: SCOWL permissive license (MIT-like); cópia integral em [LICENSE-en.txt](../public/dictionaries/LICENSE-en.txt).
- SHA-256 do arquivo original: `45a4dd29b86234fbabce26f33272466bb5572db6fdca1470c4f218e6b666a56d`.
- SHA-256 do JSON final: `a7fdeeaab121c17195163bf243303e01a1ac1b21f9111e85fd9b80a7a8f67217`.
- Alvos comuns por tamanho: 4 letras: 461; 5 letras: 569; 6 letras: 498; 7 letras: 419; 8 letras: 458.
- Complementos editoriais comuns ausentes da fonte: `defence`.

Crédito da fonte inglesa: Copyright 2000–2026 Kevin Atkinson. SCOWL utiliza, entre outras fontes, 12dicts e ENABLE2K, com contribuições de Alan Beale. A licença integral, incluindo avisos de fontes e condições de redistribuição, está preservada junto aos dados.

Metadados legíveis por máquina estão em [sources.json](../public/dictionaries/sources.json). As licenças acompanham cada distribuição.

## Reproduzir

Requer Node.js 20 ou superior e internet somente durante a geração:

```sh
node scripts/build-dictionaries.mjs
```

O script baixa revisões fixas, verifica SHA-256 de cada fonte e licença, valida os tamanhos das respostas comuns e exige ao menos 10.000 palavras únicas por idioma antes de gravar os artefatos. Ele gera JSON, a lista TypeScript de alvos comuns, as licenças, os metadados e este relatório. A geração é determinística: rodar novamente com as mesmas fontes produz os mesmos bytes.

A lista de respostas comuns é mantida em `CURATED` no script. Ao editar, use palavras minúsculas, sem acentos, no tamanho correto e regenere todos os arquivos. Não edite os arquivos gerados diretamente.
