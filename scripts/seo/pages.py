SITE='https://finderlab.com.br'
LINKEDIN='https://www.linkedin.com/company/finderlab'
INSTAGRAM='https://www.instagram.com/finderlab.ai'
PHONE='+55-11-5039-9353'
EMAIL='contato@finderlab.com.br'
# slug, arquivo, URL pública, título (<=~60), descrição (<=160), nome curto, categoria do software, tagline p/ imagem social
PAGES=[
 dict(file='index',path='/',type='home',
  title='Finder Lab · Agentes de IA sob medida para a sua operação',
  desc='Agentes de IA que atendem, qualificam e resolvem no WhatsApp e nos sistemas da sua empresa. Comece por um diagnóstico gratuito com o Drigo, da Finder Lab.',
  og_title='Agentes de IA sob medida para a sua operação',og_sub='Applied Intelligence Lab. Pesquisa que vira sistema.',name='Finder Lab'),
 dict(file='anchora',path='/anchora.html',type='product',name='Anchora',cat='BusinessApplication',
  title='Anchora · Gestão de performance agêntica | Finder Lab',
  desc='A Anchora é o sistema de Performance Management agêntico da Finder Lab: três agentes de IA leem o trabalho real e apoiam RH e líderes em decisões de carreira.',
  og_title='Anchora',og_sub='Gestão de performance ancorada em evidência, não em achismo.'),
 dict(file='zelus-health',path='/zelus-health.html',type='product',name='Zelus Health',cat='HealthApplication',
  title='Zelus Health · Histórico de saúde organizado | Finder Lab',
  desc='O Zelus Health reúne exames, hábitos e sintomas, acompanha a evolução no tempo e organiza o histórico para você chegar mais preparado à consulta.',
  og_title='Zelus Health',og_sub='Seu histórico de saúde em um só lugar, pronto para a consulta.'),
 dict(file='zelus-pet',path='/zelus-pet.html',type='product',name='Zelus Pet',cat='HealthApplication',
  title='Zelus Pet · Saúde do pet lida por espécie | Finder Lab',
  desc='O Zelus Pet lê e classifica os marcadores laboratoriais por espécie e prepara o tutor para a consulta com o veterinário. Plataforma multi-pet da Finder Lab.',
  og_title='Zelus Pet',og_sub='A saúde do seu pet, lida por espécie, pronta para o veterinário.'),
 dict(file='edi-vita',path='/edi-vita.html',type='product',name='Edi Vita',cat='BusinessApplication',
  title='Edi Vita · Gestão condominial com IA | Finder Lab',
  desc='A Edi Vita conecta síndicos, moradores, documentos e operação do condomínio, com uma assistente que responde indicando a fonte da informação.',
  og_title='Edi Vita',og_sub='A gestão do condomínio, inteligente de verdade.'),
 dict(file='famulus',path='/famulus.html',type='product',name='Famulus',cat='BusinessApplication',
  title='Famulus · Saúde e segurança do trabalho | Finder Lab',
  desc='O Famulus é o portal de saúde e segurança do trabalho da Finder Lab: o cliente pede e acompanha vidas e documentos, e a operação de SST resolve num fluxo só.',
  og_title='Famulus',og_sub='A saúde ocupacional fora do e-mail.'),
 dict(file='zelus-life',path='/zelus-life.html',type='product',name='Zelus Life',cat='HealthApplication',
  title='Zelus Life · Terapia além da sessão | Finder Lab',
  desc='A Zelus Life conecta você a um terapeuta verificado e oferece um app de humor, sono e combinados entre as sessões. Terapia sempre com gente de verdade.',
  og_title='Zelus Life',og_sub='Terapia que te acompanha além da sessão.'),
]
for p in PAGES: p['url']=SITE+p['path']; p['og']=f"/assets/seo/og-{p['file'] if p['file']!='index' else 'home'}.png"
