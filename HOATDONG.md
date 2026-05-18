# Cách hệ thống ProvenLedgerVN hoạt động

## 1. Tổng quan kiến trúc

Web này là một **dApp (Decentralized Application)** — khác với web thông thường ở chỗ không có backend server hay database truyền thống. Toàn bộ dữ liệu và logic nghiệp vụ nằm trên **smart contract** được deploy lên blockchain Polygon.

```
Người dùng → Trình duyệt (HTML/JS) → MetaMask → Smart Contract trên Polygon
```

---

## 2. Smart Contract là gì trong hệ thống này

Contract `ProvenLedgerVN` được deploy **một lần duy nhất** lên Polygon và tồn tại mãi tại một địa chỉ cố định (ví dụ: `0x1f3E...4709`). Nó đóng vai trò như "backend + database" dùng chung cho toàn bộ hệ thống:

- Lưu thông tin batch sản phẩm
- Lưu chuỗi checkpoint của từng batch
- Ghi nhận lịch sử scan của từng unit
- Quản lý phân quyền (ai được làm gì)

Dữ liệu trên contract là **append-only** — chỉ thêm, không thể sửa hay xóa, đảm bảo tính toàn vẹn.

---

## 3. Hệ thống phân quyền (Role-Based Access Control)

Hệ thống có 3 vai trò, phân quyền dựa hoàn toàn theo **địa chỉ ví MetaMask**:

| Vai trò | Quyền hạn |
|---|---|
| **Consumer** | Mặc định khi kết nối ví lần đầu. Chỉ scan QR xem thông tin sản phẩm. |
| **Manufacturer** | Đăng ký batch mới. Thêm checkpoint cho batch của mình. |
| **Admin** | Grant/revoke role cho bất kỳ địa chỉ nào. Thêm checkpoint cho bất kỳ batch nào. |

### Quy tắc cấp quyền

- Không có hệ thống đăng ký tài khoản — **ví MetaMask = danh tính**
- Ví mới kết nối vào → **Consumer mặc định**, không cần làm gì
- Muốn trở thành Manufacturer → Admin phải vào tab **Roles & Access** trên `admin.html` và grant `MANUFACTURER_ROLE` cho địa chỉ đó
- Role gắn với **địa chỉ ví cụ thể**, không phụ thuộc vào thứ tự kết nối

---

## 4. Deploy script và tại sao account deploy có cả 3 role

Khi chạy `scripts/deploy.cjs`, script thực hiện 2 việc:

1. Deploy contract → truyền địa chỉ deployer làm Admin → deployer tự động có `DEFAULT_ADMIN_ROLE` và `ADMIN_ROLE`
2. Grant luôn `MANUFACTURER_ROLE` cho deployer (để tiện test)

Đây là shortcut cho mục đích phát triển. Trong thực tế, Admin và Manufacturer nên là 2 địa chỉ ví khác nhau.

---

## 5. Phân biệt .env và config.js

### `.env` — chỉ dành cho developer

```
PRIVATE_KEY=...          # Khóa bí mật để deploy contract
POLYGON_RPC_URL=...      # Endpoint kết nối blockchain
CONTRACT_ADDRESS=...     # Dùng trong Hardhat scripts
```

File này **không bao giờ lên server**, không ai khác thấy. Chỉ dùng khi chạy scripts Hardhat (`deploy`, `simulate`, `benchmark`...).

### `public/assets/js/config.js` — dành cho người dùng cuối

```js
window.PROVENLEDGER_CONFIG = {
  CONTRACT_ADDRESS: "0x1f3E...4709",  // Địa chỉ public
  EXPECTED_CHAIN_ID: 80002n,           // Polygon Amoy
  ...
};
```

File này được serve cùng với web. Mọi người truy cập domain đều tải file này — frontend biết phải kết nối với contract nào. Người dùng không cần biết `.env` là gì.

---

## 6. Luồng khi người dùng truy cập web

```
Người dùng vào domain
      ↓
Trình duyệt tải config.js → biết CONTRACT_ADDRESS
      ↓
Người dùng nhấn "Connect Wallet" → MetaMask xác nhận
      ↓
Frontend đọc địa chỉ ví → kiểm tra role trên contract
      ↓
Consumer: chỉ dùng scan.html
Manufacturer: dùng admin.html (register batch, add checkpoint)
Admin: dùng admin.html đầy đủ (bao gồm grant/revoke role)
```

---

## 7. Tính năng Role-Based Checkpoint Updates

Checkpoint là một **mốc trạng thái trong chuỗi cung ứng** — ví dụ: "Rời nhà máy", "Đến kho", "Giao đến siêu thị". Mỗi checkpoint ghi lại:

- `actor`: Địa chỉ ví người thêm
- `timestamp`: Thời điểm (lấy từ blockchain)
- `location`: Vị trí
- `status`: Trạng thái

### Ai được thêm checkpoint?

- **Manufacturer** của batch đó
- **Admin** (bất kỳ batch nào)
- Người khác → contract revert lỗi `NotBatchOwner`

Checkpoint là append-only — không thể sửa hay xóa sau khi đã ghi.

---

## 8. Cách test với 3 account trên MetaMask

Không cần tạo email mới. Tạo thêm account ngay trong MetaMask hiện tại:

> MetaMask → icon avatar → **Add account or hardware wallet** → **Add a new Ethereum account**

Tạo 3 account, đặt tên: **Admin**, **Manufacturer**, **Consumer**.

### Quy trình demo

1. Switch sang **Admin** → vào `admin.html` → tab **Roles & Access** → grant `MANUFACTURER_ROLE` cho địa chỉ account Manufacturer
2. Switch sang **Manufacturer** → đăng ký batch → thêm checkpoint
3. Switch sang **Consumer** → mở `scan.html` → scan unit → xem thông tin
4. Consumer thử thêm checkpoint → bị revert `NotBatchOwner` → chứng minh phân quyền hoạt động đúng

Switch account trong MetaMask → web tự nhận địa chỉ mới, không cần thao tác gì thêm.

---

## 9. Cách tạo và sử dụng QR code cho Consumer

### QR của sản phẩm thật ngoài thị trường KHÔNG hoạt động

QR trên hộp Milo, Vinamilk thật, v.v. là của nhà sản xuất đó — không được đăng ký trong contract `ProvenLedgerVN`. Hệ thống chỉ nhận các batch do chính bạn đăng ký qua `admin.html`.

### Định dạng QR mà hệ thống đọc được

`scan.html` chấp nhận 2 định dạng:

```
Định dạng 1 — Raw Batch ID:
0x83196d4d75cc7d8d896a3713f6ae822ceba101978798867d501ce115c2c88267

Định dạng 2 — URL có tham số:
https://yourdomain.com/scan.html?batchId=0x83196d4d...
```

Khi camera quét được text, hệ thống tự kiểm tra: nếu là URL thì lấy tham số `?batchId=`, nếu là raw text thì dùng thẳng làm Batch ID.

### Quy trình tạo QR để test

1. Vào `admin.html` → **Register Batch** → sau khi transaction confirmed, copy **Batch ID** (`0x…` 66 ký tự)
2. Vào bất kỳ tool tạo QR nào (search Google: "QR code generator") → dán Batch ID vào → tạo ảnh QR
3. Mở `scan.html` → nhấn **Start Camera Scanner** → quét ảnh QR đó
4. Kết quả hiện ra: tên sản phẩm, ngày sản xuất, hạn dùng, checkpoints, scan count

### Test nhanh không cần camera

Dán thẳng Batch ID vào ô **"Or enter a Batch ID manually"** → nhấn **Verify**. Không cần QR, không cần camera, kết quả giống hệt.

### Các trạng thái kết quả

| Trạng thái | Điều kiện |
|---|---|
| **Verified Authentic** | Batch tồn tại trên contract, còn hạn, scan count bình thường |
| **Anomaly Detected** | Scan count > 10 — QR có thể đã bị clone |
| **Product Expired** | Batch hợp lệ nhưng `expiryDate` đã qua |
| **Batch Not Found** | Batch ID không tồn tại trong contract — hàng giả |

---

## 10. Khi public web lên domain thật

Hoạt động giống hệt localhost, chỉ khác là bất kỳ ai trên internet đều truy cập được:

- Tất cả đều dùng chung **một contract** tại địa chỉ cố định trong `config.js`
- Người dùng mới kết nối ví → Consumer mặc định
- Chỉ Admin mới có thể nâng quyền cho người khác
- Người dùng không cần cài Hardhat, không cần `.env`, chỉ cần MetaMask
