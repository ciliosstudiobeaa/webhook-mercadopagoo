// index.js
import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// Endpoint para criar preferência
app.post("/create-preference", async (req,res)=>{
  const { nome, telefone, servico, precoTotal, dataSessao, horarioSessao } = req.body;

  try {
    // Chamar Mercado Pago API para criar preference
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences",{
      method:"POST",
      headers:{
        "Authorization": `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        "Content-Type":"application/json"
      },
      body: JSON.stringify({
        items:[{ title: servico, quantity:1, unit_price: precoTotal }],
        metadata:{ nome, telefone, dataSessao, horarioSessao },
        back_urls:{ success:"https://seusite.com/sucesso" }
      })
    });

    const data = await mpRes.json();
    res.json({ init_point: data.init_point });
  } catch(err){
    console.error(err);
    res.json({ error: err.message });
  }
});

// Webhook para receber notificação de pagamento
app.post("/webhook", async (req,res)=>{
  console.log("Webhook recebido:", req.body);

  if(req.body.action==="payment.updated" && req.body.data?.id){
    const paymentId = req.body.data.id;

    // Consultar pagamento no Mercado Pago
    try {
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`,{
        headers:{ "Authorization": `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });
      const payment = await mpRes.json();

      if(payment.status==="approved"){
        // Enviar dados para Google Sheets
        await fetch("https://script.google.com/macros/s/AKfycbxKtox0VU2EMvKzZdRLCVAr-zSMuGK-8THdqlE9vh3oj4BqQfmgNlNFYV99HGMItN07/exec",{
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({
            nome: payment.metadata.nome,
            telefone: payment.metadata.telefone,
            servico: payment.metadata.servico,
            precoTotal: payment.transaction_amount,
            dataSessao: payment.metadata.dataSessao,
            horarioSessao: payment.metadata.horarioSessao,
            status: "Aprovado"
          })
        });
      }
    } catch(err){ console.error(err); }
  }

  res.status(200).send("OK");
});

app.listen(PORT, ()=>console.log(`Servidor rodando na porta ${PORT}`));
