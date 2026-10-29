# Ligar o login com Google

O código já está pronto. Falta o Google saber que o site existe e o Supabase saber falar com o Google.
Uns 10 minutos, tudo grátis. A chave secreta do Google vai direto no painel do Supabase: não precisa mandar pra ninguém.

## 1. Google Cloud: criar o cliente OAuth

1. Abra https://console.cloud.google.com/ e crie um projeto (nome sugerido: **Meu Time Politico**).
2. Menu **APIs e serviços → Tela de consentimento OAuth** (ou **Google Auth Platform → Branding**):
   - Tipo de usuário: **Externo**.
   - Nome do app: **Meu Time Político**; e-mail de suporte: o seu.
   - Domínio autorizado: `meutimepolitico.com`.
   - Escopos: só os padrão (`openid`, `email`, `profile`). Com eles o Google não exige verificação.
   - Em **Público**, clique em **Publicar app** (sai de "Teste" pra "Em produção"; senão só contas de teste entram).
3. Menu **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**.
   - Origens JavaScript autorizadas: `https://www.meutimepolitico.com` e `http://localhost:4321`.
   - URIs de redirecionamento autorizados: `https://zclxjwbpfgompypncvol.supabase.co/auth/v1/callback`
   - Crie e copie o **ID do cliente** e a **Chave secreta do cliente**.

## 2. Supabase: ligar o Google

1. https://supabase.com/dashboard/project/zclxjwbpfgompypncvol/auth/providers → **Google** → ativar,
   colar o ID do cliente e a chave secreta → **Salvar**.
2. Ainda em Providers, **Email** → desativar. O site só usa Google; com e-mail ligado, dá pra criar conta por fora.
3. https://supabase.com/dashboard/project/zclxjwbpfgompypncvol/auth/url-configuration
   - **Site URL**: `https://www.meutimepolitico.com`
   - **Redirect URLs**: `https://www.meutimepolitico.com/**` e `http://localhost:4321/**`

## 3. Conferir

Abra https://www.meutimepolitico.com, clique em **Entrar**, escolha a conta Google. Na primeira vez o site leva pra
`/seguir/`. Siga alguém, volte pra timeline, dê like num post dele e comente.

Se aparecer "redirect_uri_mismatch", o URI do passo 1.3 não está idêntico (sem barra no fim, com `https`).
