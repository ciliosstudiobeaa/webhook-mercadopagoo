import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// ===== DADOS DOS SERVIÇOS =====
const SERVICOS = {
  "Volume brasileiro": 130,
  "Efeito molhado": 140,
  "Fox eyes": 170,
  "Volume europeu": 160,
  "Volume árabe": 150,
  "Efeito rímel": 130,
  "Efeito delineado": 170,
  "Expres": 100,
  "Anime lash": 170,
  "Efeito mega": 180
};

const MANUTENCAO = {
  "15dias": {
    "Volume brasileiro": 75,
    "Efeito molhado": 80,
    "Fox eyes": 90,
    "Volume europeu": 90,
    "Volume árabe": 80,
    "Efeito rímel": 70,
    "Efeito delineado": 90,
    "Anime lash": 100,
    "Efeito mega": 100
  },
  "22dias": {
    "Volume brasileiro": 100,
    "Efeito molhado": 100,
    "Fox eyes": 120,
    "Volume europeu": 120,
    "Volume árabe": 110,
    "Efeito rímel": 100,
    "Efeito delineado": 120,
    "Anime lash": 120,
    "Efeito mega": 130
  }
};

const REMOCAO = {
  "Remoção nova": 20,
  "Remoção": 40
};

// ===== DURAÇÃO EM MINUTOS =====
const DURACAO = {
  "Aplicacao": 180,
  "Manutencao": 90,
  "Remocao": 60
};

// ===== FUNÇÃO AUXILIAR =====
function timeToMinutes(horaStr) {
  const [h, m] = horaStr.split(":").map(Number);
  return h * 60 + m;
}

function isOverlap(start1, duration1, start2, duration2){
  const end1 = start1 + duration1;
  const end2 = start2 + duration2;
  return start1 < end2 && start2 < end1;
}

// ===== ROTA TESTE =====
app.get("/", (req,res) => res.send("Servidor ativo — Mercado Pago + Google Sheets rodando!"));

// ===== FUNÇÃO PARA VERIFICAR DISPONIBILIDADE =====
async function horarioDisponivel(tipoAgendamento, dia, hora) {
  const abas = ["Agendamentos","Manutencao","Remocao"];
  const duracaoNovo = DURACAO[tipoAgendamento];
  for(const aba of abas){
    const res = await fetch(`${GOOGLE_SCRIPT_URL}?aba=${aba}`);
    const linhas = await res.json(); // [{diaagendado, horaagendada, tipoAgendamento}]
    for(const l of linhas){
      const duracaoExistente = DURACAO[l.tipoAgendamento] || 180;
      if(l.diaagendado === dia && isOverlap(timeToMinutes(hora), duracaoNovo, timeToMinutes(l.horaagendada), duracaoExistente)){
        return false;
      }
    }
  }
  return true;
}

// ===== GERAR PAGAMENTO =====
app.post("/gerar-pagamento", async (req,res)=>{
  try{
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada, tipoAgendamento="Aplicacao", manutencaoTipo=null } = req.body;

    // Verifica horário
    const disponivel = await horarioDisponivel(tipoAgendamento, diaagendado, horaagendada);
    if(!disponivel) return res.status(400).json({error:"Horário indisponível"});

    // Calcula valor correto
    let valor;
    if(tipoAgendamento==="Aplicacao") valor = SERVICOS[servico];
    else if(tipoAgendamento==="Manutencao") valor = MANUTENCAO[manutencaoTipo][servico];
    else if(tipoAgendamento==="Remocao") valor = REMOCAO[servico];
    else valor = precoTotal;

    const body = {
      items:[{title:`Sinal ${tipoAgendamento} - ${servico}`, quantity:1, currency_id:"BRL", unit_price:parseFloat(valor*0.3)}],
      payer:{name:nome,email:`${whatsapp}@ciliosdabea.fake`},
      metadata:{nome, whatsapp, servico, diaagendado, horaagendada, tipoAgendamento, manutencaoTipo},
      back_urls:{success:`https://wa.me/${whatsapp}`,failure:"https://ciliosdabea.com.br/erro"},
      auto_return:"approved"
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences",{
      method:"POST",
      headers:{"Authorization":`Bearer ${MP_ACCESS_TOKEN}`,"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });

    const data = await mpRes.json();
    return res.json({init_point:data.init_point});

  }catch(err){console.error(err); res.status(500).json({error:err.message});}
});

// ===== WEBHOOK =====
app.post("/webhook", async (req,res)=>{
  try{
    const paymentId = req.body?.data?.id;
    if(!paymentId) return res.status(200).json({ok:false,msg:"Sem paymentId"});

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`,{
      headers:{Authorization:`Bearer ${MP_ACCESS_TOKEN}`}
    });
    const paymentData = await paymentRes.json();

    if(paymentData.status==="approved"){
      const metadata = paymentData.metadata || {};
      const tipoAgendamento = metadata.tipoAgendamento || "Aplicacao";
      let aba = "Agendamentos";
      if(tipoAgendamento==="Manutencao") aba="Manutencao";
      if(tipoAgendamento==="Remocao") aba="Remocao";

      const rowData = {
        nome: metadata.nome || "Desconhecido",
        diaagendado: metadata.diaagendado || "",
        horaagendada: metadata.horaagendada || "",
        servico: metadata.servico || "",
        valor30: paymentData.transaction_amount || "",
        status: "Aprovado",
        whatsapp: metadata.whatsapp || "",
        transaction_id: paymentData.transaction_details?.transaction_id || paymentData.id || "",
        reference: "MP-"+paymentId,
        tipoAgendamento,
        manutencaoTipo: metadata.manutencaoTipo || ""
      };

      // Adiciona na aba correta
      const gRes = await fetch(GOOGLE_SCRIPT_URL,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...rowData, aba})
      });
      await gRes.text();

      // Link WhatsApp automático
      const msg = encodeURIComponent(`Olá ${metadata.nome}! 💖\n\nSeu pagamento do serviço *${metadata.servico}* foi confirmado!\n📅 Data: ${metadata.diaagendado}\n⏰ Horário: ${metadata.horaagendada}\n\nNos vemos em breve no estúdio Ciliosdabea ✨`);
      const waLink = `https://wa.me/${metadata.whatsapp}?text=${msg}`;
      console.log("📲 Link WhatsApp automático:", waLink);

      return res.status(200).json({ok:true, waLink});
    }

    return res.status(200).json({ok:false,msg:"Pagamento não aprovado"});

  }catch(err){console.error(err); res.status(500).json({ok:false,error:err.message});}
});

const PORT = process.env.PORT || 10000;
app.listen(PORT,()=>console.log(`🚀 Servidor rodando na porta ${PORT}`));
