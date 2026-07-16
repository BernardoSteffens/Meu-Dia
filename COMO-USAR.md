# Meu Dia — correção da tela branca

## O que estava errado
O `app.js` antigo dava erro "React is not defined" ao renderizar (o JSX virava
`React.createElement` sem o React no escopo) — por isso a tela ficava branca.
Este pacote recompila o JSX no modo automático, que resolve isso. Também:
- a página agora **mostra o erro na tela** se algo falhar (nada de tela branca muda);
- ela **remove service worker / cache antigos** ao abrir (uma versão quebrada podia
  ter ficado presa em cache);
- adicionei `.nojekyll` (desliga o Jekyll do GitHub Pages, por garantia).

## Como aplicar
1. **Substitua TODOS os arquivos** do repositório pelos desta pasta.
   Apague o `sw.js` antigo do repo (removi ele deste build) e mantenha o `.nojekyll`.
2. Faça o commit/push e espere ~1 min o Pages publicar.
3. No celular, por causa do service worker antigo, faça UMA limpeza:
   - abra a URL numa **aba anônima** do Chrome (ignora cache/SW) para confirmar que
     agora carrega; **ou**
   - na aba normal: Chrome → ⋮ → **Informações do site** (cadeado) →
     **Configurações do site** → **Limpar e redefinir** / limpar dados. Recarregue.
4. Deve aparecer o app. Depois: ⋮ → **Adicionar à tela inicial**.

> Se ainda aparecer algo, agora não fica branco: vem uma mensagem de erro na tela.
> Me manda o texto dela que eu resolvo.

## Voltar o modo offline (depois que estiver funcionando)
Removi o service worker neste build pra ele não atrapalhar o diagnóstico. Quando
estiver rodando, dá pra reativar o cache offline — me avisa que te devolvo o `sw.js`
e a linha de registro.

## Recompilar após mudar o código
esbuild src/main.jsx --bundle --minify --format=iife --target=es2017 --jsx=automatic \
  --outfile=dist/app.js --loader:.jsx=jsx --define:process.env.NODE_ENV='"production"'
