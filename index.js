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

// ===== FUNÇÃO AUXILIAR =====
function timeToMinutes(horaStr) {
  const [h, m] = horaStr.split(":").map(Number);
  return h * 60 + m;
}

// ===== ROTA TESTE =====
app.get("/", (req,res) => res.send("Servidor ativo — Mercado Pago + Google Sheets rodando!"));

// ===== VERIFICAR DISPONIBILIDADE SIMPLES =====
async function horarioDisponivel(dia, hora) {
  try {
    const res = await fetch(`${GOOGLE_SCRIPT_URL}?aba=Agendamentos`);
    const linhas = await res.json(); // [{diaagendado, horaagendada}]
    const novoInicio = timeToMinutes(hora);
    for(const l of linhas){
      const existenteInicio = timeToMinutes(l.horaagendada);
      if(l.diaagendado === dia && existenteInicio === novoInicio){
        return false; // horário já ocupado
      }
    }
    return true;
  } catch(err){
    console.error("Erro ao verificar disponibilidade:", err);
    return true; // se erro, assume disponível
  }
}

// ===== GERAR PAGAMENTO =====
app.post("/gerar-pagamento", async (req,res)=>{
  try{
    const { nome, whatsapp, servico, diaagendado, horaagendada } = req.body;
    console.log("📩 Recebido /gerar-pagamento:", req.body);

    // Verifica horário
    const disponivel = await horarioDisponivel(diaagendado, horaagendada);
    if(!disponivel) return res.status(400).json({error:"Horário indisponível"});

    // Valor do sinal 30%
    const valor = SERVICOS[servico];
    const sinal = parseFloat((valor*0.3).toFixed(2));

    const body = {
      items:[{title:`Sinal - ${servico}`, quantity:1, currency_id:"BRL", unit_price:sinal}],
      payer:{name:nome,email:`${whatsapp}@ciliosdabea.fake`},
      metadata:{nome, whatsapp, servico, diaagendado, horaagendada},
      back_urls:{success:"https://example.com/success",failure:"https://example.com/failure"},
      auto_return:"approved"
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences",{
      method:"POST",
      headers:{"Authorization":`Bearer ${MP_ACCESS_TOKEN}`,"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });

    const data = await mpRes.json();
    console.log("💰 Preferência Mercado Pago criada:", data);

    return res.json({init_point:data.init_point});
  } catch(err){ 
    console.error("Erro /gerar-pagamento:", err);
    res.status(500).json({error:err.message});
  }
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

    console.log("Webhook pagamento:", paymentData.status);

    if(paymentData.status==="approved"){
      const metadata = paymentData.metadata || {};
      const rowData = {
        nome: metadata.nome || "",
        diaagendado: metadata.diaagendado || "",
        horaagendada: metadata.horaagendada || "",
        servico: metadata.servico || "",
        valor30: paymentData.transaction_amount || "",
        status: "Aprovado",
        whatsapp: metadata.whatsapp || "",
        transaction_id: paymentData.id || "",
        reference: "MP-"+paymentId
      };

      // Envia para o Google Script
      const gRes = await fetch(GOOGLE_SCRIPT_URL,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(rowData)
      });
      const gText = await gRes.text();
      console.log("✅ Enviado para Google Script:", gText);

      // Gera link WhatsApp automático
      const msg = encodeURIComponent(`Olá ${metadata.nome}! 💖\n\nSeu agendamento do serviço *${metadata.servico}* foi confirmado!\n📅 Data: ${metadata.diaagendado}\n⏰ Horário: ${metadata.horaagendada}\n\nPagamento aprovado!\nNos vemos em breve no estúdio Ciliosdabea ✨`);
      const waLink = `https://wa.me/${metadata.whatsapp}?text=${msg}`;
      console.log("📲 Link WhatsApp automático:", waLink);

      return res.status(200).json({ok:true, waLink});
    }

    return res.status(200).json({ok:false,msg:"Pagamento não aprovado"});
  } catch(err){ 
    console.error("Erro no webhook:", err);
    res.status(500).json({ok:false,error:err.message});
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT,()=>console.log(`🚀 Servidor rodando na porta ${PORT}`));
