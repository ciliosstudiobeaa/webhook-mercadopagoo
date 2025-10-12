import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ✅ Rota Webhook Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("📩 Webhook recebido:", JSON.stringify(body, null, 2));

    if (body.action === "payment.created" || body.action === "payment.updated") {
      const paymentId = body.data.id;

      // Consulta o pagamento no Mercado Pago
      const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer APP_USR-8612486183152384-100921-00760da136c428f8de5c9a41652b80ee-1054558395` }, // coloca teu token real aqui
      });
      const pagamento = await resp.json();

      if (pagamento.status === "approved") {
        const metadata = pagamento.metadata || {};

        // Envia pra planilha do Google Sheets
        await fetch("https://script.google.com/macros/s/SEU_SCRIPT_ID/exec
                    ", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome: metadata.nome || pagamento.payer?.first_name || "Cliente",
            diaagendado: metadata.diaagendado || "",
            horaagendada: metadata.horaagendada || "",
            servico: metadata.servico || pagamento.description || "",
            valor: pagamento.transaction_amount,
            status: "Aprovado",
            whatsapp: metadata.whatsapp || "",
          }),
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    res.sendStatus(500);
  }
});

app.listen(10000, () => console.log("🚀 Webhook ativo na porta 10000"));
