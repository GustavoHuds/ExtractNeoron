# Catálogo Belmont — Entregáveis

Gerado a partir da **RELAÇÃO DE PRODUTOS** (catálogo completo) + **referências de loja**,
com imagens do servidor `s9.chianca.net`. Escopo: **1.488 produtos** (todos os itens da
relação + códigos exclusivos das referências), deduplicados por código.

## Arquivos

| Arquivo | O que é | Tamanho |
|---|---|---|
| **Catalogo-Belmont-Lista.pdf** | Catálogo em **modo lista** (fotos pequenas) — preços + relação, muitos itens/página. | ~3,5 MB (76 págs) |
| **Catalogo-Belmont-Visual.pdf** | Catálogo **visual** (fotos grandes, estilo revista), 3 produtos por linha. | ~22 MB (169 págs) |
| **site/** | Site responsivo (abra `site/index.html`): busca, filtro por categoria, cards e modal. | ~27 MB |
| **image-book/** | Banco de imagens full-res por código (`{codigo}.jpg`) + `index.html` (grade) + `manifest.csv`. | ~135 MB |
| **data/catalogo-dados.json / .csv** | Dataset unificado (código, nome, categoria, preço, cor, medidas, imagem, lojas). | — |
| **assets/** · **scripts/** | Logo/placeholder · pipeline reproduzível. | — |

## Números
- **1.488 produtos**, 19 categorias.
- **683 com foto** de catálogo (45%); os demais usam placeholder Belmont.
- **1.413 com preço > 0**; itens **sem estoque ficam com R$ 0,00** (conforme regra).
- Maiores categorias: Sofás (244), Colchões (199), Bases Box (137), Eletro (130), Cozinhas (127), Mesas & Cadeiras (124), Guarda-Roupas (98), Travesseiros (87).

## Regras aplicadas
- **Dedup** por código (chave única).
- **Preço**: varejo das referências → **Preço Base** da relação → **0**. Preço **0 = fora de estoque**.
- **Imagem**: baixada de `s9.chianca.net/imagens/383/{codigo}.jpg`; sem imagem → placeholder.
- Nomes normalizados do formato interno para exibição comercial (Title Case, abreviações expandidas, medidas/cor extraídas). Descrições geradas a partir do nome (tipo + cor + medidas).

## Como regenerar
```bash
python scripts/pipeline.py
```
Requer Python 3 + PyMuPDF, Pillow, reportlab, requests (já instalados).
As imagens ficam cacheadas em `image-book/` (só baixa o que faltar).

## Ajustes fáceis
- **Reduzir o Visual PDF**: baixar `maxpx`/`quality` em `generate_pdf.py` (`fit(...,560)` → 480).
- **Preço por loja específica** (em vez do máximo entre lojas): ajustar `retail()` em `build_dataset.py`.
- **Filtrar só itens com estoque/preço**: filtrar a lista em `build_dataset.py`.
