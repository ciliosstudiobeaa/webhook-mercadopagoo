import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

const paymentStatusMap = {};

// TESTE
app.get("/", (req, res) => res.send("Servidor ativo!"));

// GERAR PAGAMENTO
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

    // cria uma preferência de pagamento
    const body = {
      items: [
        {
          title: `Sinal - ${servico}`,
          quantity: 1,
          currency_id: "BRL",
          unit_price: parseFloat(precoTotal * 0.3),
        },
      ],
      payer: { name: nome, email: `${whatsapp}@ciliosdabea.fake` },
      metadata: { nome, whatsapp, servico, diaagendado, horaagendada },
      back_urls: {
        success: "https://ciliosdabea.netlify.app/aguardando.html", // página de espera
        failure: "https://ciliosdabea.netlify.app/erro.html",
      },
      auto_return: "approved",
      notification_url: "https://webhook-mercadopagoo.onrender.com/webhook",
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await mpRes.json();

    // salva os dados temporariamente
    paymentStatusMap[data.id] = {
      status: "pending",
      rowData: { nome, whatsapp, servico, diaagendado, horaagendada, precoTotal },
    };

    // envia a URL da página aguardando junto com paymentId
    const aguardandoUrl = `https://ciliosdabea.netlify.app/aguardando.html?paymentId=${encodeURIComponent(
      data.id
    )}&nome=${encodeURIComponent(nome)}&whatsapp=${encodeURIComponent(
      whatsapp
    )}&servico=${encodeURIComponent(servico)}&diaagendado=${encodeURIComponent(
      diaagendado
    )}&horaagendada=${encodeURIComponent(horaagendada)}`;

    return res.json({ init_point: data.init_point, aguardandoUrl, paymentId: data.id });
  } catch (err) {
    console.error("Erro ao gerar pagamento:", err);
    return res.status(500).json({ error: err.message });
  }
});

// WEBHOOK MERCADO PAGO
app.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;
    if (!paymentId) return res.status(200).json({ ok: false, msg: "Sem paymentId" });

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const paymentData = await paymentRes.json();
    const status = paymentData.status;

    if (status === "approved") {
      const metadata = paymentData.metadata || {};
      const rowData = {
        nome: metadata.nome || "Desconhecido",
        diaagendado: metadata.diaagendado || "",
        horaagendada: metadata.horaagendada || "",
        servico: metadata.servico || "",
        valor30: paymentData.transaction_amount || "",
        status: "Aprovado",
        whatsapp: metadata.whatsapp || "",
        transaction_id:
          paymentData.transaction_details?.transaction_id || paymentData.id || "",
        reference: "MP-" + paymentId,
      };

      // Envia para o Google Script
      await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rowData),
      });

      // Atualiza status na memória
      paymentStatusMap[paymentId] = { status: "approved", rowData };
      console.log("✅ Pagamento aprovado:", rowData);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Erro no webhook:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// STATUS PAGAMENTO (usado pela página aguardando)
app.get("/status-pagamento", (req, res) => {
  const { paymentId } = req.query;
  if (!paymentId) return res.status(400).json({ ok: false, msg: "paymentId necessário" });
  const record = paymentStatusMap[paymentId];
  if (!record) return res.json({ status: "pending" });
  res.json({ status: record.status, rowData: record.rowData });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
