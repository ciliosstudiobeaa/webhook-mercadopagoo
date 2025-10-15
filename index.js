import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(express.json());
app.use(cors());

// ⚙️ Substitua pelo seu token de acesso do Mercado Pago
const TOKEN = "APP_USR-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxxx";

let paymentStatusMap = {}; // Armazena o status dos pagamentos em memória

// 🚀 Gera a preferência de pagamento
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

    const preference = {
      items: [
        {
          title: `${servico} — ${nome}`,
          quantity: 1,
          unit_price: precoTotal,
          currency_id: "BRL",
        },
      ],
      payer: {
        name: nome,
      },
      back_urls: {
        success: `https://seusite.netlify.app/aguardando.html?paymentId={payment_id}&nome=${encodeURIComponent(nome)}&whatsapp=${encodeURIComponent(whatsapp)}&servico=${encodeURIComponent(servico)}&diaagendado=${encodeURIComponent(diaagendado)}&horaagendada=${encodeURIComponent(horaagendada)}`,
        pending: `https://seusite.netlify.app/aguardando.html?paymentId={payment_id}&nome=${encodeURIComponent(nome)}&whatsapp=${encodeURIComponent(whatsapp)}&servico=${encodeURIComponent(servico)}&diaagendado=${encodeURIComponent(diaagendado)}&horaagendada=${encodeURIComponent(horaagendada)}`,
        failure: `https://seusite.netlify.app/erro.html`,
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
      console.log("❌ Erro ao gerar pagamento:", data);
      return res.status(400).json({ error: "Erro ao criar pagamento", data });
    }

    res.json({
      url: data.init_point,
      id: data.id,
    });
  } catch (err) {
    console.error("Erro ao gerar pagamento:", err);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

// 🧩 Webhook do Mercado Pago (recebe notificações automáticas)
app.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type !== "payment") return res.sendStatus(200);

    const paymentId = data.id;
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    const paymentData = await response.json();
    if (paymentData.id) {
      paymentStatusMap[paymentData.id] = paymentData.status;
      console.log(`✅ Pagamento ${paymentData.id} atualizado para: ${paymentData.status}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.sendStatus(500);
  }
});

// 🔍 Endpoint para verificar o status do pagamento
app.get("/status-pagamento", async (req, res) => {
  const { paymentId } = req.query;
  if (!paymentId) return res.status(400).json({ error: "Faltando paymentId" });

  // Se já tiver salvo em memória, retorna direto
  if (paymentStatusMap[paymentId]) {
    return res.json({ status: paymentStatusMap[paymentId] });
  }

  // Caso contrário, busca direto da API do Mercado Pago
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
