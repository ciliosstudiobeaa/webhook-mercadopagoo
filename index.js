import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const WA_API_URL = process.env.WA_API_URL; // sua API para enviar WhatsApp

let validTokens = {}; // token temporário com status

// === ROTA TESTE ===
app.get("/", (req,res)=>res.send("Servidor ativo! 🚀"));

// === GERAR PAGAMENTO ===
app.post("/gerar-pagamento", async (req,res)=>{
  try{
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

    const token = crypto.randomBytes(16).toString("hex");
    validTokens[token] = { nome, whatsapp, servico, diaagendado, horaagendada, status:"pending", createdAt: Date.now() };

    const body = {
      items:[{title:`Sinal - ${servico}`,quantity:1,currency_id:"BRL",unit_price:Number(precoTotal)*0.3}],
      payer:{name:nome,email:`${whatsapp}@ciliosdabea.fake`},
      metadata:{nome,whatsapp,servico,diaagendado,horaagendada,token},
      back_urls:{
        success:`https://ciliosdabea.netlify.app/aguardando.html?token=${token}`,
        failure:`https://ciliosdabea.netlify.app/erro.html`
      },
      auto_return:"approved"
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences",{
      method:"POST",
      headers:{Authorization:`Bearer ${MP_ACCESS_TOKEN}`,"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });

    const data = await mpRes.json();
    if(!data.init_point) return res.status(500).json({error:"Erro ao gerar pagamento",details:data});

    res.json({init_point:data.init_point});

  }catch(err){console.error(err); res.status(500).json({error:err.message});}
});

// === WEBHOOK ===
app.post("/webhook", async (req,res)=>{
  try{
    const paymentId = req.body?.data?.id;
    if(!paymentId) return res.status(200).json({ok:false,msg:"Sem paymentId"});

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`,{
      headers:{Authorization:`Bearer ${MP_ACCESS_TOKEN}`}
    });
    const paymentData = await paymentRes.json();

    if(["approved","authorized"].includes(paymentData.status)){
      const m = paymentData.metadata;
      const token = m.token;
      const [ano,mes,dia] = m.diaagendado?.split("-")||[];
      const dataBR = dia&&mes&&ano?`${dia}/${mes}/${ano}`:m.diaagendado||"";

      // Atualizar status do token
      if(validTokens[token]) validTokens[token].status="approved";

      // Enviar para Google Sheets
      const rowData = {
        nome:m.nome,
        diaagendado:dataBR,
        horaagendada:m.horaagendada,
        servico:m.servico,
        valor30:paymentData.transaction_amount,
        status:"Aprovado",
        whatsapp:m.whatsapp,
        transaction_id:paymentData.transaction_details?.transaction_id||paymentData.id,
        reference:"MP-"+paymentId
      };
      await fetch(GOOGLE_SCRIPT_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(rowData)});

      // Enviar WhatsApp
      const msg = `Olá ${m.nome}! Seu agendamento para ${m.servico} em ${dataBR} às ${m.horaagendada} foi confirmado! 💅✨`;
      try{
        await fetch(WA_API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:m.whatsapp,message:msg})});
      }catch(e){console.error("Erro WhatsApp:",e);}

      return res.status(200).json({ok:true,token});
    }

    res.status(200).json({ok:false,msg:"Pagamento não aprovado"});
  }catch(err){console.error(err);res.status(500).json({ok:false,error:err.message});}
});

// === VALIDAR TOKEN ===
app.post("/validate-token",(req,res)=>{
  const { token } = req.body;
  if(!token||!validTokens[token]) return res.json({valid:false});
  const data = validTokens[token];
  if(Date.now()-data.createdAt>5*60*1000){ delete validTokens[token]; return res.json({valid:false}); }
  res.json({valid:true,data});
});

// === CHECK STATUS FRONTEND ===
app.post("/check-status",(req,res)=>{
  const { token } = req.body;
  if(!token||!validTokens[token]) return res.json({valid:false,approved:false});
  const t = validTokens[token];
  res.json({valid:true,approved:t.status==="approved",data:t});
});

const PORT = process.env.PORT||10000;
app.listen(PORT,()=>console.log(`Servidor rodando na porta ${PORT}`));
