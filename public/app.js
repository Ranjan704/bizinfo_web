const $ = s => document.querySelector(s);
let user = null, companies = [], activeCompany = null, authMode = "signup";
const money = paise => "₹" + (paise/100).toLocaleString("en-IN");
$("#year").textContent = new Date().getFullYear();

async function api(url, options={}) {
  const response = await fetch(url,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600)}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function renderUser(){
  $("#userLabel").textContent=user?`Hi, ${user.name.split(" ")[0]}`:"";
  $("#loginBtn").classList.toggle("hidden",!!user);$("#signupBtn").classList.toggle("hidden",!!user);
  $("#logoutBtn").classList.toggle("hidden",!user);
  if(user?.role==="admin") $("#userLabel").textContent += " · Admin";
}
async function loadCompanies(){
  const params=new URLSearchParams({q:$("#searchInput").value,industry:$("#industryFilter").value});
  const data=await api("/api/companies?"+params);companies=data.companies;
  $("#resultCount").textContent=`${companies.length} ${companies.length===1?"profile":"profiles"} found`;
  const industries=[...new Set(companies.map(c=>c.industry))].sort();
  const select=$("#industryFilter"), current=select.value;
  select.innerHTML='<option value="">All industries</option>'+industries.map(i=>`<option>${escapeHtml(i)}</option>`).join("");
  select.value=current;
  $("#companyGrid").innerHTML=companies.length?companies.map(c=>`
    <article class="company-card"><div class="card-top"><div class="card-symbol">${escapeHtml(c.name.charAt(0).toUpperCase())}</div><span class="tag">${escapeHtml(c.industry)}</span></div>
    <h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.description||"Company profile available in the directory.")}</p>
    <div class="card-bottom"><span>${c.purchased?"✓ Purchased":"Company profile"}</span><button data-company="${c.id}">View profile ↗</button></div></article>`).join(""):'<div class="loading">No matching companies found. Try another search.</div>';
  document.querySelectorAll("[data-company]").forEach(b=>b.addEventListener("click",()=>openCompany(Number(b.dataset.company))));
}
async function openCompany(id){
  try{
    const data=await api(`/api/companies/${id}`);activeCompany=data.company;
    $("#detailName").textContent=activeCompany.name;$("#detailIndustry").textContent=activeCompany.industry;
    $("#detailDescription").textContent=activeCompany.description||"Company profile.";
    $("#lockedPanel").classList.toggle("hidden",data.unlocked);
    $("#fullDetails").classList.toggle("hidden",!data.unlocked);
    $("#paymentNotice").textContent="";
    if(data.unlocked) renderFullDetails(activeCompany);
    else $("#priceLabel").textContent=money((await api("/api/companies")).pricePaise);
    $("#detailModal").classList.remove("hidden");
  }catch(e){toast(e.message)}
}
function renderFullDetails(c){
  $("#fullDetails").innerHTML=`<div class="detail-line"><b>Company address</b>${escapeHtml(c.address)}</div><div class="detail-line"><b>Website</b><a href="${safeUrl(c.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.website)}</a></div><div class="detail-line"><b>Industry</b>${escapeHtml(c.industry)}</div>`;
}
function safeUrl(value){try{const u=new URL(value);return ["http:","https:"].includes(u.protocol)?u.href:"#"}catch{return "#"}}
function showAuth(mode){
  authMode=mode;$("#authTitle").textContent=mode==="signup"?"Create your account":"Welcome back";
  $("#authSubtitle").textContent=mode==="signup"?"Sign up to explore company profiles.":"Log in to access your account.";
  $("#nameWrap").classList.toggle("hidden",mode==="login");$("#nameWrap input").required=mode==="signup";
  $("#authSubmit").textContent=mode==="signup"?"Create account":"Log in";
  $("#authSwitch").innerHTML=mode==="signup"?'Already have an account? <button type="button" id="switchAuth">Log in</button>':'New to BIZINFO? <button type="button" id="switchAuth">Create account</button>';
  $("#switchAuth").onclick=()=>showAuth(mode==="signup"?"login":"signup");
  $("#authNotice").textContent="";$("#authForm").reset();$("#authModal").classList.remove("hidden");
}
$("#loginBtn").onclick=()=>showAuth("login");$("#signupBtn").onclick=()=>showAuth("signup");
$("#logoutBtn").onclick=async()=>{await api("/api/logout",{method:"POST"});user=null;renderUser();loadCompanies();toast("You have logged out.")};
$("#authForm").onsubmit=async e=>{
  e.preventDefault();const form=new FormData(e.target),body=Object.fromEntries(form.entries());
  try{const data=await api("/api/"+(authMode==="signup"?"signup":"login"),{method:"POST",body:JSON.stringify(body)});user=data.user;renderUser();$("#authModal").classList.add("hidden");loadCompanies();toast("Welcome to BIZINFO.");}
  catch(err){$("#authNotice").textContent=err.message}
};
$("#buyBtn").onclick=async()=>{
  if(!user){$("#detailModal").classList.add("hidden");showAuth("login");return}
  try{
    const order=await api(`/api/checkout/${activeCompany.id}`,{method:"POST",body:"{}"});
    if(!window.Razorpay) throw new Error("Payment checkout could not load. Check your internet connection.");
    const checkout=new Razorpay({key:order.keyId,amount:order.amount,currency:order.currency,name:"BIZINFO",description:"Company profile access",order_id:order.orderId,
      prefill:{name:user.name,email:user.email},theme:{color:"#3568e8"},
      handler:async response=>{
        try{await api("/api/payment/verify",{method:"POST",body:JSON.stringify(response)});$("#detailModal").classList.add("hidden");await openCompany(activeCompany.id);loadCompanies();toast("Payment verified. Profile unlocked.");}
        catch(err){$("#paymentNotice").textContent=err.message}
      }});
    checkout.on("payment.failed",r=>$("#paymentNotice").textContent=r.error?.description||"Payment failed. Please try again.");
    checkout.open();
  }catch(err){$("#paymentNotice").textContent=err.message}
};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>b.closest(".modal-backdrop").classList.add("hidden"));
["authModal","detailModal"].forEach(id=>$("#"+id).addEventListener("click",e=>{if(e.target.id===id)e.target.classList.add("hidden")}));
let searchTimer;$("#searchInput").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadCompanies,180)});
$("#industryFilter").addEventListener("change",loadCompanies);
(async()=>{try{user=(await api("/api/me")).user;renderUser();await loadCompanies()}catch(e){$("#companyGrid").innerHTML='<div class="loading">Could not connect to the server.</div>'}})();
