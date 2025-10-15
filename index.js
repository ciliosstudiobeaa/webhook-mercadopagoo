import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// === ARMAZENAMENTO TEMPORÁRIO DE PAGAMENTOS ===
const pagamentos = {}; 
// Estrutura: pagamentos[paymentId] = {status, diaagendado, horaagendada, servico, nome, whatsapp}

// === ROTA DE TESTE ===
app.get("/", (req, res) => {
  res.send("Servidor ativo — integração Mercado Pago + Google Sheets rodando!");
});

// === CARREGAR AGENDAMENTOS EXISTENTES DA PLANILHA ===
app.get("/carregar-agendamentos", async (req, res) => {
  try {
    const response = await fetch(GOOGLE_SCRIPT_URL);
    const data = await response.json(); // Espera um array de agendamentos da planilha
    console.log("📦 Agendamentos carregados da planilha:", data.length);

    data.forEach((row, index) => {
      // Criamos um ID fictício único para cada linha
      const paymentId = `sheet-${index}`;
      pagamentos[paymentId] = {
        status: "approved",
        diaagendado: row.diaagendado,
        horaagendada: row.horaagendada,
        servico: row.servico,
        nome: row.nome,
        whatsapp: row.whatsapp,
        reference: row.reference || "",
      };
    });

    res.json({ ok: true, total: data.length });
  } catch (err) {
    console.error("❌ Erro ao carregar agendamentos:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === GERAR PAGAMENTO ===
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    console.log("📦 Dados recebidos do front:", req.body);

    const body = {
      items: [
        {
          title: `Sinal de agendamento - ${servico}`,
          quantity: 1,
          currency_id: "BRL",
          unit_price: parseFloat(precoTotal * 0.3),
        },
      ],
      payer: {
        name: nome,
        email: `${whatsapp}@ciliosdabea.fake`,
      },
      metadata: { nome, whatsapp, servico, diaagendado, horaagendada },
      back_urls: {
        success: "https://ciliosdabea.com.br/aguardando",
        failure: "https://ciliosdabea.com.br/erro",
      },
      auto_return: "approved",
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await mpRes.json();
    console.log("✅ Preferência criada:", data.id);

    pagamentos[data.id] = { status: "pending", diaagendado, horaagendada, servico, nome, whatsapp };
    return res.json({ init_point: data.init_point, id: data.id });

  } catch (err) {
    console.error("❌ Erro ao gerar pagamento:", err);
    return res.status(500).json({ error: err.message });
  }
});

// === WEBHOOK MERCADO PAGO ===
app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 Webhook recebido:", JSON.stringify(req.body));

    const paymentId = req.body?.data?.id;
    if (!paymentId) return res.status(200).json({ ok: false, msg: "Sem paymentId" });

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const paymentData = await paymentRes.json();
    const status = paymentData.status;

    pagamentos[paymentId] = {
      ...pagamentos[paymentId],
      status,
      diaagendado: paymentData.metadata?.diaagendado || pagamentos[paymentId]?.diaagendado || "",
      horaagendada: paymentData.metadata?.horaagendada || pagamentos[paymentId]?.horaagendada || "",
      servico: paymentData.metadata?.servico || pagamentos[paymentId]?.servico || "",
      nome: paymentData.metadata?.nome || pagamentos[paymentId]?.nome || "",
      whatsapp: paymentData.metadata?.whatsapp || pagamentos[paymentId]?.whatsapp || "",
    };

    console.log(`🔎 Status do pagamento ${paymentId}: ${status}`);

    if (status === "approved") {
      const rowData = {
        nome: pagamentos[paymentId].nome,
        diaagendado: pagamentos[paymentId].diaagendado,
        horaagendada: pagamentos[paymentId].horaagendada,
        servico: pagamentos[paymentId].servico,
        valor30: paymentData.transaction_amount || "",
        status: "Aprovado",
        whatsapp: pagamentos[paymentId].whatsapp,
        transaction_id: paymentData.transaction_details?.transaction_id || paymentData.id || "",
        reference: "MP-" + paymentId,
      };

      const gRes = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rowData),
      });

      const gData = await gRes.text();
      console.log("📤 Retorno do Google Script:", gData);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// === STATUS PAGAMENTO ===
app.get("/status/:paymentId", (req, res) => {
  const { paymentId } = req.params;
  const status = pagamentos[paymentId]?.status || "pending";
  res.json({ status });
});

// === HORÁRIOS OCUPADOS ===
app.get("/horarios/:date", (req, res) => {
  const { date } = req.params;
  const ocupados = [];

  for (const info of Object.values(pagamentos)) {
    if (info.status === "approved" && info.diaagendado === date) {
      ocupados.push(info.horaagendada);
    }
  }

  res.json({ ocupados });
});

// === INICIALIZA SERVIDOR ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);

  // Carregar agendamentos da planilha ao iniciar
  try {
    const res = await fetch(`${GOOGLE_SCRIPT_URL}`);
    const data = await res.json();
    data.forEach((row,index)=>{
      const paymentId = `sheet-${index}`;
      pagamentos[paymentId] = {
        status: "approved",
        diaagendado: row.diaagendado,
        horaagendada: row.horaagendada,
        servico: row.servico,
        nome: row.nome,
        whatsapp: row.whatsapp,
        reference: row.reference || "",
      };
    });
    console.log(`📦 ${data.length} agendamentos carregados da planilha.`);
  } catch(err){
    console.error("❌ Falha ao carregar agendamentos da planilha:", err);
  }
});
