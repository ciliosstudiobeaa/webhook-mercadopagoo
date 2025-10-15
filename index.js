import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(express.json());
app.use(cors());

const TOKEN = process.env.MP_ACCESS_TOKEN; // 🔐 Token do Mercado Pago
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL; // 🔗 Planilha Google

let paymentStatusMap = {}; // Armazena o status em memória

// 🚀 Criação da preferência de pagamento
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

    const baseUrl = "https://seusite.netlify.app"; // 🟡 Substitua pelo domínio do seu site

    const preference = {
      items: [
        {
          title: `${servico} — ${nome}`,
          quantity: 1,
          unit_price: precoTotal,
          currency_id: "BRL",
        },
      ],
      payer: { name: nome },
      back_urls: {
        success: `${baseUrl}https://ciliosdabea.netlify.app/aguardando.html?paymentId=1054558395-723ef7db-2be7-4d3d-b91a-a09cc6bc6e8a&nome=Msmsjsisnsndksn&whatsapp=19999016506&servico=Efeito%20Mega&diaagendado=2025-10-15&horaagendada=18%3A00/aguardando.html?paymentId={payment_id}&nome=${encodeURIComponent(nome)}&whatsapp=${encodeURIComponent(whatsapp)}&servico=${encodeURIComponent(servico)}&diaagendado=${encodeURIComponent(diaagendado)}&horaagendada=${encodeURIComponent(horaagendada)}`,
        pending: `${baseUrl}https://ciliosdabea.netlify.app/aguardando.html?paymentId=1054558395-723ef7db-2be7-4d3d-b91a-a09cc6bc6e8a&nome=Msmsjsisnsndksn&whatsapp=19999016506&servico=Efeito%20Mega&diaagendado=2025-10-15&horaagendada=18%3A00/aguardando.html?paymentId={payment_id}&nome=${encodeURIComponent(nome)}&whatsapp=${encodeURIComponent(whatsapp)}&servico=${encodeURIComponent(servico)}&diaagendado=${encodeURIComponent(diaagendado)}&horaagendada=${encodeURIComponent(horaagendada)}`,
        failure: `${baseUrl}https://ciliosdabea.netlify.app/aguardando.html?paymentId=1054558395-723ef7db-2be7-4d3d-b91a-a09cc6bc6e8a&nome=Msmsjsisnsndksn&whatsapp=19999016506&servico=Efeito%20Mega&diaagendado=2025-10-15&horaagendada=18%3A00/erro.html`,
      },
      auto_return: "approved",
      notification_url: "https://webhook-mercadopagoo.onrender.com/webhook",
    };

    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preference),
    });

    const data = await response.json();

    if (!data.init_point) {
      console.error("❌ Erro ao gerar pagamento:", data);
      return res.status(400).json({ error: "Erro ao criar pagamento", data });
    }

    res.json({ url: data.init_point, id: data.id });
  } catch (err) {
    console.error("Erro ao gerar pagamento:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// 🔔 Webhook Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type !== "payment") return res.sendStatus(200);

    const paymentId = data.id;
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    const paymentData = await response.json();
    if (!paymentData.id) return res.sendStatus(200);

    paymentStatusMap[paymentData.id] = paymentData.status;
    console.log(`✅ Pagamento ${paymentData.id}: ${paymentData.status}`);

    // Se aprovado, envia para o Google Script
    if (paymentData.status === "approved") {
      await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: paymentData.payer?.first_name || "",
          servico: paymentData.description || "",
          valor: paymentData.transaction_amount,
          status: paymentData.status,
          paymentId: paymentData.id,
        }),
      });
      console.log("📊 Dados enviados para Google Sheets!");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.sendStatus(500);
  }
});

// 🔎 Verificação de status (usado pela página aguardando.html)
app.get("/status-pagamento", async (req, res) => {
  const { paymentId } = req.query;
  if (!paymentId) return res.status(400).json({ error: "Faltando paymentId" });

  if (paymentStatusMap[paymentId]) {
    return res.json({ status: paymentStatusMap[paymentId] });
  }

  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const data = await response.json();

    if (data.status) {
      paymentStatusMap[paymentId] = data.status;
      return res.json({ status: data.status });
    } else {
      return res.status(404).json({ status: "not_found" });
    }
  } catch (err) {
    console.error("Erro ao consultar status:", err);
    res.status(500).json({ error: "Erro ao consultar status" });
  }
});

app.listen(10000, () => console.log("✅ Servidor rodando na porta 10000"));
