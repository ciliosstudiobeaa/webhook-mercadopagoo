import fetch from "node-fetch";

const URL = "https://webhook-mercadopagoo.onrender.com"; // substitua pela URL do seu backend

async function ping() {
  try {
    const res = await fetch(URL);
    console.log(`Ping enviado! Status: ${res.status}`);
  } catch (err) {
    console.error("Erro ao pingar o backend:", err);
  }
}

// Ping a cada 5 minutos (300.000 ms)
setInterval(ping, 300000);

// Ping inicial
ping();
