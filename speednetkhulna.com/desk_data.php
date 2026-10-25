<?php
// T E S T I N G   P H A S E 
// *** টেস্টিং শেষ হলে এই দুটি লাইন অবশ্যই কমেন্ট করে দিন ***
// error_reporting(E_ALL);
// ini_set('display_errors', 1);


// ১. ডেটাবেস কানেকশন কনফিগারেশন (S4: no hard-coded creds in docroot)
// Priority: env vars → config file OUTSIDE docroot → fail with generic message.
// Server setup: set DESK_DB_USER / DESK_DB_PASS as env, OR create
//   <docroot-parent>/desk_db_config.php  returning ['user'=>..,'pass'=>..,'name'=>..,'host'=>..]
$servername = getenv('DESK_DB_HOST') ?: 'localhost';
$dbname     = getenv('DESK_DB_NAME') ?: 'desk_qr_db';
$username   = getenv('DESK_DB_USER') ?: '';
$password   = getenv('DESK_DB_PASS') ?: '';
if ($username === '' || $password === '') {
    $outsideConfig = dirname(__DIR__) . '/desk_db_config.php';
    if (is_file($outsideConfig)) {
        $cfg = include $outsideConfig;
        if (is_array($cfg)) {
            $servername = $cfg['host'] ?? $servername;
            $dbname     = $cfg['name'] ?? $dbname;
            $username   = $cfg['user'] ?? $username;
            $password   = $cfg['pass'] ?? $password;
        }
    }
}
if ($username === '' || $password === '') {
    error_log('desk_data: DB credentials not configured');
    http_response_code(500);
    die('সেবাটি সাময়িকভাবে অনুপলব্ধ। পরে আবার চেষ্টা করুন।');
}

// ডেটাবেস কানেকশন এবং ত্রুটি সামলানো (never expose raw DB errors)
$conn = @new mysqli($servername, $username, $password, $dbname);

if ($conn->connect_error) {
    error_log('desk_data: DB connect failed: ' . $conn->connect_error);
    http_response_code(500);
    die('সেবাটি সাময়িকভাবে অনুপলব্ধ। পরে আবার চেষ্টা করুন।');
}

// ২. URL থেকে desk id নেওয়া এবং ইনপুট যাচাইকরণ
$deskId = isset($_GET['id']) ? trim($_GET['id']) : '';

if ($deskId === '') {
    $conn->close();
    die("URL-এ ডেস্ক আইডি (Desk ID) নেই।");
}

// ৩. Prepared statement
$sql = "SELECT desk_number, emp_name, designation, email 
        FROM desk_info 
        WHERE desk_number = ?";

$stmt = $conn->prepare($sql);

if (!$stmt) {
    error_log('desk_data: prepare failed: ' . $conn->error);
    $conn->close();
    http_response_code(500);
    die('সেবাটি সাময়িকভাবে অনুপলব্ধ। পরে আবার চেষ্টা করুন।');
}

// ৪. প্যারামিটার যুক্ত করা, এক্সিকিউট এবং রেজাল্ট আনা
$stmt->bind_param("s", $deskId);
$stmt->execute();

// mysqli_stmt::get_result() এর বদলে bind_result() ব্যবহার করা হয়েছে, যা আপনার সার্ভারে সমর্থিত
$stmt->store_result();

if ($stmt->num_rows > 0) {
    // রেজাল্ট ভ্যারিয়েবলগুলো bind
    $stmt->bind_result($desk_number, $emp_name, $designation, $email);
    $stmt->fetch();
    ?>
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Desk Info - <?= htmlspecialchars($desk_number) ?></title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            /* উন্নত CSS */
            :root {
                --primary-color: #3498db; 
                --text-color: #333;
                --bg-color: #ecf0f1;
            }
            body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                background: var(--bg-color); 
                padding: 20px; 
                color: var(--text-color);
            }
            .card {
                max-width: 400px;
                margin: 40px auto;
                background: #ffffff;
                padding: 30px; 
                border-radius: 12px; 
                box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                border-top: 5px solid var(--primary-color); 
            }
            h2 { 
                text-align: center;
                color: var(--primary-color); 
                margin-bottom: 20px;
            }
            .info-item {
                display: flex;
                justify-content: space-between;
                padding: 10px 0;
                border-bottom: 1px dashed #eee;
            }
            .info-item:last-child {
                border-bottom: none;
            }
            .label { 
                font-weight: bold; 
                color: #555;
                flex-shrink: 0;
            }
            .value {
                text-align: right;
                max-width: 60%;
                word-wrap: break-word; 
            }
            @media (max-width: 600px) {
                body { padding: 10px; }
                .card { margin: 10px auto; padding: 20px; }
            }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>👤 ডেস্ক ইনফরমেশন</h2>
            <div class="info-item">
                <span class="label">ডেস্ক নাম্বার:</span> 
                <span class="value"><?= htmlspecialchars($desk_number) ?></span>
            </div>
            <div class="info-item">
                <span class="label">কর্মচারীর নাম:</span> 
                <span class="value"><?= htmlspecialchars($emp_name) ?></span>
            </div>
            <div class="info-item">
                <span class="label">পদবি:</span> 
                <span class="value"><?= htmlspecialchars($designation) ?></span>
            </div>
            <div class="info-item">
                <span class="label">ইমেইল:</span> 
                <span class="value"><?= htmlspecialchars($email) ?></span>
            </div>
        </div>
    </body>
    </html>
    <?php
} else {
    // ডেটা না পেলে
    die("দুঃখিত, **" . htmlspecialchars($deskId) . "** ডেস্ক আইডির জন্য কোনো তথ্য পাওয়া যায়নি।");
}

$stmt->close();
$conn->close();

?>