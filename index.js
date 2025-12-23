const mammoth = require("mammoth");

mammoth.extractRawText({ path: "isilo_kent.docx" })
.then(res => {
    console.log(res.value);
});
